export function createInt32Buffer(number: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(number, 0);
  return buf;
}

export function createUInt32Buffer(number: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(number, 0);
  return buf;
}
