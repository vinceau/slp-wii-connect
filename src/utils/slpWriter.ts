import net from 'net';
import _ from 'lodash';
import { SlpFile, SlpFileMetadata } from './slpFile';
import { SlpRawStream, SlpRawEvent, Command, PostFrameUpdateType, GameEndType } from 'slp-realtime';

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
  private rawStream: SlpRawStream;

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
    this.rawStream = new SlpRawStream();
    this.rawStream.on(SlpRawEvent.RAW_COMMAND, (command: Command, buffer: Uint8Array) => {
      if (this.currentFile !== null) {
        this.currentFile.write(buffer);
      }
    })
    this.rawStream.on(SlpRawEvent.POST_FRAME_UPDATE, (command: Command, payload: PostFrameUpdateType) => {
      this._handlePostFrameUpdate(command, payload);
    })
    this.rawStream.on(SlpRawEvent.MESSAGE_SIZES, () => {
      console.log("new game started");
      this._handleNewGame();
    })
    this.rawStream.on(SlpRawEvent.GAME_END, (command: Command, payload: GameEndType) => {
      console.log("game ended");
      this._handleEndGame(command, payload);
    })
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

  public handleData(newData: Uint8Array): void {
    this.rawStream.write(newData);

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
  }

  private _handleNewGame(): void {
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

  private _handlePostFrameUpdate(command: number, payload: PostFrameUpdateType): void {
    // Here we need to update some metadata fields
    const frameIndex = payload.frame;
    const playerIndex = payload.playerIndex;
    const isFollower = payload.isFollower;
    const internalCharacterId = payload.internalCharacterId;

    if (isFollower) {
      // No need to do this for follower
      return;
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
  }

  private _handleEndGame(command: Command, payload: GameEndType): void {
    const endMethod = payload.gameEndMethod;
    if (endMethod !== 7) {
      this.handleStatusOutput(700);
    }

    // End the stream
    this.currentFile.setMetadata(this.metadata);
    this.currentFile.end();
    console.log("Finished writing file.");
    // Clear current file
    this.currentFile = null;
    // Update file state
    this.onFileStateChange();
  }

}