import net from 'net';
import { EventEmitter } from 'events';
import _ from 'lodash';
import StrictEventEmitter from 'strict-event-emitter-types';

import { ConsoleCommunication, CommunicationType, CommunicationMessage } from './communication';

const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;
const DEFAULT_IP = "0.0.0.0";
const DEFAULT_PORT = 666;

export enum ConnectionStatus {
  DISCONNECTED = 0,
  CONNECTING = 1,
  CONNECTED = 2,
  RECONNECTING = 3,
};

export interface ConnectionDetails {
  consoleNickname: string;
  gameDataCursor: Uint8Array;
  version: string;
  clientToken: number;
}

export interface ConnectionSettings {
  ipAddress: string;
  port: number;
}

enum CommunicationState {
  INITIAL = "initial",
  LEGACY = "legacy",
  NORMAL = "normal",
}

interface RetryState {
  retryCount: number;
  retryWaitMs: number;
  reconnectHandler: NodeJS.Timeout;
}

const defaultConnectionDetails: ConnectionDetails = {
  consoleNickname: "unknown",
  gameDataCursor: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]),
  version: "",
  clientToken: 0,
}


interface ConsoleConnectionEvents {
  handshake: ConnectionDetails;
  statusChange: ConnectionStatus;
  data: Uint8Array;
}

interface ConsoleConnectionEventEmitter {
  new(): StrictEventEmitter<EventEmitter, ConsoleConnectionEvents>;
};

/**
 * Responsible for maintaining connection to a Slippi relay connection or Wii connection.
 * Events are emitted whenever data is received.
 *
 * Basic usage example:
 *
 * ```javascript
 * const { ConsoleConnection } = require("@vinceau/slp-wii-connect");
 *
 * const connection = new ConsoleConnection();
 * connection.connect(address, port);
 *
 * connection.on("data", (data) => {
 *   // Received data from console
 *   console.log(data);
 * });
 *
 * connection.on("statusChange", (status) => {
 *   console.log(`status changed: ${status}`);
 * });
 * ```
 */
export class ConsoleConnection extends (EventEmitter as ConsoleConnectionEventEmitter) {
  private ipAddress: string;
  private port: number;
  private connectionStatus = ConnectionStatus.DISCONNECTED;
  private client: net.Socket = null;
  private connDetails: ConnectionDetails = { ...defaultConnectionDetails };
  private connectionRetryState: RetryState;

  public constructor() {
    super();
    this.ipAddress = DEFAULT_IP;
    this.port = DEFAULT_PORT;
    this._resetRetryState();
  }

  /**
   * @returns The current connection status.
   */
  public getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * @returns The IP address and port of the current connection.
   */
  public getSettings(): ConnectionSettings {
    return {
      ipAddress: this.ipAddress,
      port: this.port,
    };
  }

  /**
   * @returns The specific details about the connected console.
   */
  public getDetails(): ConnectionDetails {
    return this.connDetails;
  }

  /**
   * Initiate a connection to the Wii or Slippi relay.
   * @param ip   The IP address of the Wii or Slippi relay.
   * @param port The port to connect to.
   * @param timeout Optional. The timeout in milliseconds when attempting to connect
   *                to the Wii or relay. Default: 5000.
   */
  public connect(ip: string, port: number, timeout = DEFAULT_CONNECTION_TIMEOUT_MS): void {
    this.ipAddress = ip;
    this.port = port;

    // We need to update settings here in order for any
    // changes to settings to be propagated

    // Indicate we are connecting
    this._setStatus(ConnectionStatus.CONNECTING);

    // Prepare console communication obj for talking UBJSON
    const consoleComms = new ConsoleCommunication();

    // TODO: reconnect on failed reconnect, not sure how
    // TODO: to do this
    const client = net.connect({
      host: this.ipAddress,
      port: this.port,
    }, () => {
      console.log(`Connected to ${this.ipAddress}:${this.port}!`);
      clearTimeout(this.connectionRetryState.reconnectHandler);
      this._resetRetryState();
      this._setStatus(ConnectionStatus.CONNECTED);

      const handshakeMsgOut = consoleComms.genHandshakeOut(
        this.connDetails.gameDataCursor, this.connDetails.clientToken
      );

      // console.log({
      //   'raw': handshakeMsgOut,
      //   'string': handshakeMsgOut.toString(),
      //   'cursor': this.connDetails.gameDataCursor,
      // });
      client.write(handshakeMsgOut);
    });

    client.setTimeout(timeout);

    let commState: CommunicationState = CommunicationState.INITIAL;
    client.on('data', (data) => {
      if (commState === CommunicationState.INITIAL) {
        commState = this._getInitialCommState(data);
        console.log(`Connected to source with type: ${commState}`);
        // console.log(data.toString("hex"));
      }

      if (commState === CommunicationState.LEGACY) {
        // If the first message received was not a handshake message, either we
        // connected to an old Nintendont version or a relay instance
        this._handleReplayData(data);
        return;
      }

      consoleComms.receive(data);
      const messages = consoleComms.getMessages();

      // Process all of the received messages
      _.forEach(messages, message => this._processMessage(message));
    });

    client.on('timeout', () => {
      // const previouslyConnected = this.connectionStatus === ConnectionStatus.CONNECTED;
      console.log(`Attempted connection to ${this.ipAddress}:${this.port || DEFAULT_PORT} timed out after ${timeout}ms`);
      client.destroy();

      // TODO: Fix reconnect logic
      // if (this.connDetails.token !== "0x00000000") {
      //   // If previously connected, start the reconnect logic
      //   this._startReconnect();
      // }
    });

    client.on('error', (error) => {
      console.log('error');
      console.log(error);
      client.destroy();
    });

    client.on('end', () => {
      console.log('disconnect');
      client.destroy();
    });

    client.on('close', () => {
      console.log('connection was closed');
      this.client = null;
      this._setStatus(ConnectionStatus.DISCONNECTED);

      // TODO: Fix reconnect logic
      // // After attempting first reconnect, we may still fail to connect, we should keep
      // // retrying until we succeed or we hit the retry limit
      // if (this.connectionRetryState.retryCount) {
      //   this._startReconnect();
      // }
    });

    this.client = client;
  }

  /**
   * Terminate the current connection.
   */
  public disconnect(): void {
    const reconnectHandler = this.connectionRetryState.reconnectHandler;
    if (reconnectHandler) {
      clearTimeout(reconnectHandler);
    }

    if (this.client) {
      // TODO: Confirm destroy is picked up by an action and disconnected
      // TODO: status is set
      this.client.destroy();
    }
  }

  private _getInitialCommState(data: Buffer): CommunicationState {
    if (data.length < 13) {
      return CommunicationState.LEGACY;
    }

    const openingBytes = Buffer.from([
      0x7b, 0x69, 0x04, 0x74, 0x79, 0x70, 0x65, 0x55, 0x01,
    ]);

    const dataStart = data.slice(4, 13);

    return dataStart.equals(openingBytes) ? CommunicationState.NORMAL : CommunicationState.LEGACY;
  }

  private _processMessage(message: CommunicationMessage): void {
    switch (message.type) {
    case CommunicationType.KEEP_ALIVE:
      // console.log("Keep alive message received");

      // TODO: This is the jankiest shit ever but it will allow for relay connections not
      // TODO: to time out as long as the main connection is still receving keep alive messages
      // TODO: Need to figure out a better solution for this. There should be no need to have an
      // TODO: active Wii connection for the relay connection to keep itself alive
      const fakeKeepAlive = Buffer.from("HELO\0");
      this._handleReplayData(fakeKeepAlive);

      break;
    case CommunicationType.REPLAY:
      // console.log("Replay message type received");
      // console.log(message.payload.pos);
      this.connDetails.gameDataCursor = Uint8Array.from(message.payload.pos);

      const data = Uint8Array.from(message.payload.data);
      this._handleReplayData(data);
      break;
    case CommunicationType.HANDSHAKE:
      // console.log("Handshake message received");
      // console.log(message);

      this.connDetails.consoleNickname = message.payload.nick;
      const tokenBuf = Buffer.from(message.payload.clientToken as any);
      this.connDetails.clientToken = tokenBuf.readUInt32BE(0);;
      this.emit("handshake", this.connDetails);
      break;
    default:
      // Should this be an error?
      break;
    }
  }

  private _handleReplayData(data: Uint8Array): void {
    this.emit("data", data);
  }

  private _setStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    this.emit("statusChange", this.connectionStatus);
  }

  private _resetRetryState(): void {
    this.connectionRetryState = {
      retryCount: 0,
      retryWaitMs: 1000,
      reconnectHandler: null,
    };
  }

  // private _startReconnect(): void {
  //   const retryState = this.connectionRetryState;
  //   if (retryState.retryCount >= 5) {
  //     // Stop reconnecting after 5 attempts
  //     this._setStatus(ConnectionStatus.DISCONNECTED);
  //     return;
  //   }

  //   const waitTime = retryState.retryWaitMs;
  //   console.log(`Setting reconnect handler with time: ${waitTime}ms`);
  //   const reconnectHandler = setTimeout(() => {
  //     console.log(`Trying to reconnect after waiting: ${waitTime}ms`);
  //     this.connect();
  //   }, retryState.retryWaitMs);

  //   // Prepare next retry state
  //   this.connectionRetryState = {
  //     ...retryState,
  //     retryCount: retryState.retryCount + 1,
  //     retryWaitMs: retryState.retryWaitMs * 2,
  //     reconnectHandler: reconnectHandler,
  //   };

  //   this._setStatus(ConnectionStatus.RECONNECTING);
  // }

}

