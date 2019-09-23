import { ConsoleConnection } from "./console/connection";

const conn = new ConsoleConnection({
  ipAddress: "0.0.0.0",
  port: 1667,
  isRelaying: false,
});

conn.connect();