import _ from 'lodash';
import fs, { WriteStream } from 'fs';
import moment, { Moment } from 'moment';
import { createUInt32Buffer, createInt32Buffer } from './helpers';
import { Writable, WritableOptions } from 'stream';

const defaultNickname = "unknown";

export interface SlpFileMetadata {
  consoleNickname?: string;
  lastFrame: number;
  players: any;
};

export class SlpFile extends Writable {
  private filePath: string;
  private metadata: SlpFileMetadata | null = null;
  private fileStream: WriteStream;
  private rawDataLength = 0;
  private startTime: Moment;

  public constructor(filePath: string, opts?: WritableOptions) {
    super(opts);
    this.filePath = filePath;
    this.startTime = moment();
    this._initializeNewGame(this.filePath);
    this.on("finish", () => {
      // Write bytes written
      const fd = fs.openSync(this.filePath, "r+");
      (fs as any).writeSync(fd, createUInt32Buffer(this.rawDataLength), 0, "binary", 11);
      fs.closeSync(fd);
    });
  }

  public path(): string {
    return this.filePath;
  }

  public setMetadata(metadata: SlpFileMetadata): void {
    this.metadata = metadata;
  }

  public _write(chunk: Uint8Array, encoding: string, callback: (error?: Error | null) => void): void {
    if (encoding !== "buffer") {
      throw new Error(`Unsupported stream encoding. Expected 'buffer' got '${encoding}'.`);
    }
    this.fileStream.write(chunk);
    this.rawDataLength += chunk.length;
    callback();
  }

  private _initializeNewGame(filePath: string): void {
    this.fileStream = fs.createWriteStream(filePath, {
      encoding: 'binary',
    });

    const header = Buffer.concat([
      Buffer.from("{U"),
      Buffer.from([3]),
      Buffer.from("raw[$U#l"),
      Buffer.from([0, 0, 0, 0]),
    ]);
    this.fileStream.write(header);

    console.log(`Creating new file at: ${filePath}`);
  }

  public _final(callback: (error?: Error | null) => void): void {
    let footer = Buffer.concat([
      Buffer.from("U"),
      Buffer.from([8]),
      Buffer.from("metadata{"),
    ]);

    // Write game start time
    const startTimeStr = this.startTime.toISOString();
    footer = Buffer.concat([
      footer,
      Buffer.from("U"),
      Buffer.from([7]),
      Buffer.from("startAtSU"),
      Buffer.from([startTimeStr.length]),
      Buffer.from(startTimeStr),
    ]);

    // Write last frame index
    // TODO: Get last frame
    const lastFrame = this.metadata.lastFrame;
    footer = Buffer.concat([
      footer,
      Buffer.from("U"),
      Buffer.from([9]),
      Buffer.from("lastFramel"),
      createInt32Buffer(lastFrame),
    ]);

    // write the Console Nickname
    const consoleNick = this.metadata.consoleNickname || defaultNickname;
    footer = Buffer.concat([
      footer,
      Buffer.from("U"),
      Buffer.from([11]),
      Buffer.from("consoleNickSU"),
      Buffer.from([consoleNick.length]),
      Buffer.from(consoleNick),
    ]);

    // Start writting player specific data
    footer = Buffer.concat([
      footer,
      Buffer.from("U"),
      Buffer.from([7]),
      Buffer.from("players{"),
    ]);
    const players = this.metadata.players;
    _.forEach(players, (player, index) => {
      // Start player obj with index being the player index
      footer = Buffer.concat([
        footer,
        Buffer.from("U"),
        Buffer.from([index.length]),
        Buffer.from(`${index}{`),
      ]);

      // Start characters key for this player
      footer = Buffer.concat([
        footer,
        Buffer.from("U"),
        Buffer.from([10]),
        Buffer.from("characters{"),
      ]);

      // Write character usage
      _.forEach(player.characterUsage, (usage, internalId) => {
        // Write this character
        footer = Buffer.concat([
          footer,
          Buffer.from("U"),
          Buffer.from([internalId.length]),
          Buffer.from(`${internalId}l`),
          createUInt32Buffer(usage),
        ]);
      });

      // Close characters and player
      footer = Buffer.concat([
        footer,
        Buffer.from("}}"),
      ]);
    });

    // Close players
    footer = Buffer.concat([
      footer,
      Buffer.from("}"),
    ]);

    // Write played on
    footer = Buffer.concat([
      footer,
      Buffer.from("U"),
      Buffer.from([8]),
      Buffer.from("playedOnSU"),
      Buffer.from([7]),
      Buffer.from("network"),
    ]);
    
    // Close metadata and file
    footer = Buffer.concat([
      footer,
      Buffer.from("}}"),
    ]);

    // End the stream
    this.fileStream.write(footer, callback);
  }
}
