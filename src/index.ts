import { ConsoleConnection, ConnectionEvent, ConnectionDetails } from "./console/connection";
import { SlpFileWriter } from "./utils/slpWriter";

const slpWriter = new SlpFileWriter({
  folderPath: "./",
  consoleNick: "unknown"
});

const conn = new ConsoleConnection({
  ipAddress: "0.0.0.0",
  port: 1667,
});

conn.on(ConnectionEvent.DATA, (data: Buffer) => {
  slpWriter.handleData(data);
})

conn.on(ConnectionEvent.HANDSHAKE, (settings: ConnectionDetails) => {
  slpWriter.updateSettings({
    consoleNick: settings.consoleNick,
  });
})

conn.connect();