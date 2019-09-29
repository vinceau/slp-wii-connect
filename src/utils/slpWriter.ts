import path from "path";
import _ from 'lodash';
import moment, { Moment } from 'moment';
import { SlpFile, SlpFileMetadata } from './slpFile';
import { SlpRawStream, SlpRawEvent, Command, PostFrameUpdateType } from 'slp-realtime';

export interface SlpFileWriterOptions {
  folderPath: string;
  consoleNick: string;
}

export class SlpFileWriter {
  private folderPath: string;
  private consoleNick: string;
  private currentFile: SlpFile | null;
  private metadata: SlpFileMetadata;
  private rawStream: SlpRawStream;

  public constructor(settings: SlpFileWriterOptions) {
    this.folderPath = settings.folderPath;
    this.consoleNick = settings.consoleNick;
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
    this.rawStream.on(SlpRawEvent.GAME_END, () => {
      console.log("game ended");
      this._handleEndGame();
    })
  }

  public updateSettings(settings: SlpFileWriterOptions): void {
    this.folderPath = settings.folderPath;
    this.consoleNick = settings.consoleNick || this.consoleNick;
  }

  public handleData(newData: Uint8Array): void {
    this.rawStream.write(newData);
  }

  private _handleNewGame(): void {
    const filePath = getNewFilePath(this.folderPath, moment());
    this.currentFile = new SlpFile(filePath);
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

  private _handleEndGame(): void {
    // End the stream
    this.currentFile.setMetadata(this.metadata);
    this.currentFile.end();
    console.log("Finished writing file.");
    // Clear current file
    this.currentFile = null;
  }

}

const getNewFilePath = (folder: string, m: Moment): string => {
  return path.join(folder, `Game_${m.format("YYYYMMDD")}T${m.format("HHmmss")}.slp`);
}