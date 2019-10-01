import net from 'net';
import _ from 'lodash';

import { ConsoleCommunication, CommunicationType, CommunicationMessage } from './communication';
import { EventEmitter } from 'events';

const DEFAULT_PORT = 1666;

export enum ConnectionEvent {
  HANDSHAKE = "handshake",
  DATA = "data"
}

export enum ConnectionStatus {
  DISCONNECTED = 0,
  CONNECTING = 1,
  CONNECTED = 2,
  RECONNECTING = 3,
};

export interface ConsoleConnectionOptions {
  ipAddress: string;
  port: number;
}

export interface ConnectionDetails {
  gameDataCursor: Uint8Array;
  consoleNick: string;
  version: string;
  clientToken: number;
}

interface RetryState {
  retryCount: number;
  retryWaitMs: number;
  reconnectHandler: NodeJS.Timeout;
}

interface ConnectionSettings {
  ipAddress: string;
  port: number;
  consoleNick: string;
}

export class ConsoleConnection extends EventEmitter {
  private ipAddress: string;
  private port: number;
  private connectionStatus: ConnectionStatus;
  private client: net.Socket;
  private connDetails: ConnectionDetails;
  private connectionRetryState: RetryState;

  public constructor(settings: ConsoleConnectionOptions) {
    super();
    this.ipAddress = settings.ipAddress;
    this.port = settings.port;

    this.client = null;
    this.connectionStatus = ConnectionStatus.DISCONNECTED;
    this.connDetails = {
      gameDataCursor: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]),
      consoleNick: "unknown",
      version: "",
      clientToken: 0,
    }
    this.connectionRetryState = this.getDefaultRetryState();
  }

  public fileStateChangeHandler = (): void => {
  }

  public getSettings(): ConnectionSettings {
    return {
      ipAddress: this.ipAddress,
      port: this.port,
      consoleNick: this.connDetails.consoleNick,
    };
  }

  public getDefaultRetryState(): RetryState {
    return {
      retryCount: 0,
      retryWaitMs: 1000,
      reconnectHandler: null,
    }
  }

  public startReconnect(): void {
    const retryState = this.connectionRetryState;
    if (retryState.retryCount >= 5) {
      // Stop reconnecting after 5 attempts
      this.connectionStatus = ConnectionStatus.DISCONNECTED;
      return;
    }

    const waitTime = retryState.retryWaitMs;
    console.log(`Setting reconnect handler with time: ${waitTime}ms`);
    const reconnectHandler = setTimeout(() => {
      console.log(`Trying to reconnect after waiting: ${waitTime}ms`);
      this.connect();
    }, retryState.retryWaitMs);

    // Prepare next retry state
    this.connectionRetryState = {
      ...retryState,
      retryCount: retryState.retryCount + 1,
      retryWaitMs: retryState.retryWaitMs * 2,
      reconnectHandler: reconnectHandler,
    };

    this.connectionStatus = ConnectionStatus.RECONNECTING;
  }

  public editSettings(newSettings: ConnectionSettings): void {
    // If data is not provided, keep old values
    this.ipAddress = newSettings.ipAddress || this.ipAddress;
    this.port = newSettings.port || this.port;
  }

  public connect(): void {
    // We need to update settings here in order for any
    // changes to settings to be propagated

    // Indicate we are connecting
    this.connectionStatus = ConnectionStatus.CONNECTING;

    // Prepare console communication obj for talking UBJSON
    const consoleComms = new ConsoleCommunication();

    // TODO: reconnect on failed reconnect, not sure how
    // TODO: to do this
    const client = net.connect({
      host: this.ipAddress,
      port: this.port || DEFAULT_PORT,
    }, () => {
      console.log(`Connected to ${this.ipAddress}:${this.port || DEFAULT_PORT}!`);
      clearTimeout(this.connectionRetryState.reconnectHandler);
      this.connectionRetryState = this.getDefaultRetryState();
      this.connectionStatus = ConnectionStatus.CONNECTED;

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

    client.setTimeout(20000);

    let commState = "initial";
    client.on('data', (data) => {
      if (commState === "initial") {
        commState = this.getInitialCommState(data);
        console.log(`Connected to source with type: ${commState}`);
        console.log(data.toString("hex"));
      }

      if (commState === "legacy") {
        // If the first message received was not a handshake message, either we
        // connected to an old Nintendont version or a relay instance
        this.handleReplayData(data);
        return;
      }

      consoleComms.receive(data);
      const messages = consoleComms.getMessages();

      // Process all of the received messages
      _.forEach(messages, message => this.processMessage(message));
    });

    client.on('timeout', () => {
      // const previouslyConnected = this.connectionStatus === ConnectionStatus.CONNECTED;
      console.log(`Timeout on ${this.ipAddress}:${this.port || DEFAULT_PORT}`);
      client.destroy();

      // TODO: Fix reconnect logic
      // if (this.connDetails.token !== "0x00000000") {
      //   // If previously connected, start the reconnect logic
      //   this.startReconnect();
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
      this.connectionStatus = ConnectionStatus.DISCONNECTED;

      // TODO: Fix reconnect logic
      // // After attempting first reconnect, we may still fail to connect, we should keep
      // // retrying until we succeed or we hit the retry limit
      // if (this.connectionRetryState.retryCount) {
      //   this.startReconnect();
      // }
    });

    this.client = client;
  }

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

  public getInitialCommState(data: Buffer): string {
    if (data.length < 13) {
      return "legacy";
    }

    const openingBytes = Buffer.from([
      0x7b, 0x69, 0x04, 0x74, 0x79, 0x70, 0x65, 0x55, 0x01,
    ]);

    const dataStart = data.slice(4, 13);

    return dataStart.equals(openingBytes) ? "normal" : "legacy";
  }

  public processMessage(message: CommunicationMessage): void {
    switch (message.type) {
    case CommunicationType.KEEP_ALIVE:
      // console.log("Keep alive message received");

      // TODO: This is the jankiest shit ever but it will allow for relay connections not
      // TODO: to time out as long as the main connection is still receving keep alive messages
      // TODO: Need to figure out a better solution for this. There should be no need to have an
      // TODO: active Wii connection for the relay connection to keep itself alive
      const fakeKeepAlive = Buffer.from("HELO\0");
      this.handleReplayData(fakeKeepAlive);

      break;
    case CommunicationType.REPLAY:
      // console.log("Replay message type received");
      // console.log(message.payload.pos);
      this.connDetails.gameDataCursor = Uint8Array.from(message.payload.pos);

      const data = Uint8Array.from(message.payload.data);
      this.handleReplayData(data);
      break;
    case CommunicationType.HANDSHAKE:
      // console.log("Handshake message received");
      // console.log(message);

      this.connDetails.consoleNick = message.payload.nick;
      const tokenBuf = Buffer.from(message.payload.clientToken as any);
      this.connDetails.clientToken = tokenBuf.readUInt32BE(0);;
      this.emit(ConnectionEvent.HANDSHAKE, this.connDetails);
      break;
    default:
      // Should this be an error?
      break;
    }
  }

  public handleReplayData(data: Uint8Array): void {
    this.emit(ConnectionEvent.DATA, data);
  }

}

