import net from 'net';
import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import moment, { Moment } from 'moment';
import { SlpFile, SlpFileMetadata } from './slpFile';


// const AllFrames: Array<number> = [];

export interface SlpFileWriterOptions {
  targetFolder: string;
  id: number;
  isRelaying: boolean;
  folderPath: string;
  consoleNick: string;
  onFileStateChange: () => void;
}

interface ClientData {
  socket: net.Socket;
  readPos: number;
};

export interface HandleDataResponse {
  isNewGame: boolean;
  isGameEnd: boolean;
};

export enum WriteCommand {
  CMD_RECEIVE_COMMANDS = 0x35,
  CMD_GAME_START = 0x36,
  CMD_RECEIVE_POST_FRAME_UPDATE = 0x38,
  CMD_RECEIVE_GAME_END = 0x39,
}

export class SlpFileWriter {
  private server: net.Server;
  private folderPath: string;
  private onFileStateChange: any;
  private id: number;
  private consoleNick: string;
  private currentFile: SlpFile | null;
  private statusOutput: any;
  private isRelaying: boolean;
  private clients: Array<ClientData>;
  private bytesWritten = 0;
  private metadata: SlpFileMetadata;
  private previousBuffer: Uint8Array = Buffer.from([]);
  private fullBuffer: Uint8Array = Buffer.from([]);
  private payloadSizes = new Map<number, number>();

  public constructor(settings: SlpFileWriterOptions) {
    this.folderPath = settings.folderPath;
    this.onFileStateChange = settings.onFileStateChange;
    this.id = settings.id;
    this.consoleNick = settings.consoleNick;
    this.statusOutput = {
      status: false,
      timeout: null,
    };
    this.isRelaying = settings.isRelaying;
    this.clients = [];
    this.manageRelay();
    this.metadata = {
      lastFrame: -124,
      players: {},
    };
  }

  public manageRelay(): void {
    if (!this.isRelaying) {
      if (this.server) {
        this.server.close();
      }

      this.server = null;
      this.clients = [];

      return;
    }
    
    if (this.server) {
      // If server is already up, no need to start
      return;
    }
    
    this.server = net.createServer((socket) => {
      socket.setNoDelay().setTimeout(20000);

      const clientData: ClientData = {
        socket: socket,
        readPos: 0,
      };

      this.clients.push(clientData);
      socket.on("close", (err) => {
        if (err) console.log(err);
        _.remove(this.clients, (client) => socket === client.socket);
      });
    });
    this.server.listen(666 + this.id, '0.0.0.0');
  }

  public getCurrentFilePath(): string {
    return this.currentFile.path();
  }

  public updateSettings(settings: SlpFileWriterOptions): void {
    this.folderPath = settings.targetFolder;
    this.id = settings.id;
    this.isRelaying = settings.isRelaying;
    this.consoleNick = settings.consoleNick || this.consoleNick;
    this.manageRelay();
  }

  public handleStatusOutput(timeoutLength = 100): void {
    const setTimer = (): void => {
      if (this.statusOutput.timeout) {
        // If we have a timeout, clear it
        clearTimeout(this.statusOutput.timeout);
      }

      this.statusOutput.timeout = setTimeout(() => {
        // If we timeout, set and set status
      }, timeoutLength);
    }

    if (this.metadata.lastFrame < -60) {
      // Only show the source in the later portion of the game loading stage
      return;
    }

    if (this.statusOutput.status) {
      // If game is currently active, reset the timer
      setTimer();
      return;
    }

    // Set timer
    setTimer();
  }

  public handleData(newData: Uint8Array): HandleDataResponse {
    let isNewGame = false;
    let isGameEnd = false;

    const data = Uint8Array.from(Buffer.concat([
      this.previousBuffer,
      newData,
    ]));

    const dataView = new DataView(data.buffer);

    let index = 0;
    while (index < data.length) {
      if (Buffer.from(data.slice(index, index + 5)).toString() === "HELO\0") {
        // This is a consequence of the way our network communication works, "HELO" messages are
        // sent periodically to avoid the timeout logic. Just ignore them.
        index += 5;
        continue;
      }

      // TODO: Here we are parsing slp file data. Seems pretty silly to do this when
      // TODO: logic already exists in the parser to do it... Should eventually reconcile
      // TODO: the two.

      // Make sure we have enough data to read a full payload
      const command = dataView.getUint8(index);
      const payloadSize = _.get(this.currentFile, ['payloadSizes', command]) || 0;
      const remainingLen = data.length - index;
      if (remainingLen < payloadSize + 1) {
        // If remaining length is not long enough for full payload, save the remaining
        // data until we receive more data. The data has been split up.
        this.previousBuffer = data.slice(index);
        break;
      }

      // Clear previous buffer here, dunno where else to do this
      this.previousBuffer = Buffer.from([]);

      // Increment by one for the command byte
      index += 1;

      // Prepare to write payload
      const payloadPtr = data.slice(index);
      const payloadDataView = new DataView(data.buffer, index);
      let payloadLen = 0;


      // const frame = readInt32(payloadDataView, 0x1);
      // const event = parseDataView(command, payloadDataView);
      // if (event) {
      // AllFrames.push(frame);
      // console.log(`${frame} ${command}`);
      // AllFrames.push((event as any).frame);
      // console.log(`${(event as any).frame} ${command}`);
      // }

      switch (command) {
      case WriteCommand.CMD_RECEIVE_COMMANDS:
        isNewGame = true;
        this.initializeNewGame();
        payloadLen = this.processReceiveCommands(payloadDataView);
        this.writeCommand(command, payloadPtr, payloadLen);
        this.onFileStateChange();
        break;
      case WriteCommand.CMD_RECEIVE_GAME_END:
        payloadLen = this.processCommand(command, payloadDataView);
        this.writeCommand(command, payloadPtr, payloadLen);
        this.endGame();
        isGameEnd = true;
        // console.log(AllFrames);
        break;
      case WriteCommand.CMD_GAME_START:
        payloadLen = this.processCommand(command, payloadDataView);
        this.writeCommand(command, payloadPtr, payloadLen);
        break;
      default:
        payloadLen = this.processCommand(command, payloadDataView);
        this.writeCommand(command, payloadPtr, payloadLen);
        this.handleStatusOutput();
        break;
      }

      index += payloadLen;
    }

    // Write data to relay, we do this after processing in the case there is a new game, we need
    // to have the buffer ready
    this.fullBuffer = Buffer.concat([this.fullBuffer, newData]);

    if (this.clients) {
      const buf = this.fullBuffer;
      _.each(this.clients, (client) => {
        client.socket.write(buf.slice(client.readPos));

        // eslint doesn't like the following line... I feel like it's a valid use case but idk,
        // maybe there's risks with doing this?
        client.readPos = buf.byteLength; // eslint-disable-line
      });
    }

    return {
      isNewGame: isNewGame,
      isGameEnd: isGameEnd,
    };
  }

  public writeCommand(command: number, payloadPtr: Uint8Array, payloadLen: number): void {
    // Write data
    if (!this.currentFile) {
      return;
    }

    // Keep track of how many bytes we have written to the file
    this.bytesWritten += (payloadLen + 1);

    const payloadBuf = payloadPtr.slice(0, payloadLen);
    const bufToWrite = Buffer.concat([
      Buffer.from([command]),
      payloadBuf,
    ]);

    try {
      this.currentFile.write(bufToWrite);
    } catch (err) {
      console.error(err);
    }
  }

  public initializeNewGame(): void {
    this.currentFile = new SlpFile({
      folderPath: "./",
      consoleNick: "hello",
    });

    // Clear clients back to position zero
    this.clients = _.map(this.clients, client => ({
      ...client,
      readPos: 0,
    }));
  }

  public getNewFilePath(m: Moment): string {
    return path.join("./", `Game_${m.format("YYYYMMDD")}T${m.format("HHmmss")}.slp`);
  }

  public endGame(): void {
    // End the stream
    this.currentFile.on("finish", () => {
      // Write bytes written
      const fd = fs.openSync(this.currentFile.path(), "r+");
      (fs as any).writeSync(fd, this.createUInt32Buffer(this.bytesWritten), 0, "binary", 11);
      fs.closeSync(fd);

      console.log("Finished writting file.");

      // Clear current file
      this.currentFile = null;

      // Update file state
      this.onFileStateChange();
    });
    this.currentFile.setMetadata(this.metadata);
    this.currentFile.end();
  }

  public createInt32Buffer(number: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(number, 0);
    return buf;
  }

  public createUInt32Buffer(number: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(number, 0);
    return buf;
  }

  public processReceiveCommands(dataView: DataView): number {
    const payloadLen = dataView.getUint8(0);
    for (let i = 1; i < payloadLen; i += 3) {
      const commandByte = dataView.getUint8(i);
      const payloadSize = dataView.getUint16(i + 1);
      this.payloadSizes.set(commandByte, payloadSize);
    }

    return payloadLen;
  }

  public processCommand(command: number, dataView: DataView): number {
    const payloadSize = this.payloadSizes.get(command);
    if (!payloadSize) {
      // TODO: Flag some kind of error
      return 0;
    }

    switch (command) {
    case WriteCommand.CMD_RECEIVE_POST_FRAME_UPDATE:
      // Here we need to update some metadata fields
      const frameIndex = dataView.getInt32(0);
      const playerIndex = dataView.getUint8(4);
      const isFollower = dataView.getUint8(5);
      const internalCharacterId = dataView.getUint8(6);

      if (isFollower) {
        // No need to do this for follower
        break;
      }

      // Update frame index
      this.metadata.lastFrame = frameIndex;

      // Update character usage
      const prevPlayer = _.get(this.currentFile, ['metadata', 'players', `${playerIndex}`]) || {};
      const characterUsage = prevPlayer.characterUsage || {};
      const curCharFrames = characterUsage[internalCharacterId] || 0;
      const player = {
        ...prevPlayer,
        "characterUsage": {
          ...characterUsage,
          [internalCharacterId]: curCharFrames + 1,
        },
      };

      this.metadata.players[`${playerIndex}`] = player;

      break;
    case WriteCommand.CMD_RECEIVE_GAME_END:
      const endMethod = dataView.getUint8(0);

      if (endMethod !== 7) {
        this.handleStatusOutput(700);
      }

      break;
    default:
      // Nothing to do
      break;
    }
    return payloadSize;
  }
}

