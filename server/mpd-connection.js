// Keep socket failures on the normal end-of-stream path. mpc-js 2.1.1
// cancels its response stream without handling the rejection if it errored.
import { MPC } from "mpc-js";
import { createConnection } from "node:net";

export class MPDConnection extends MPC {
  connectTCP(host, port) {
    const socket = createConnection({ host, port });
    let closed = false;
    const stream = new ReadableStream({
      start(controller) {
        const finish = () => {
          if (closed) return;
          closed = true;
          controller.close();
        };
        socket.on("data", (chunk) => {
          if (!closed) controller.enqueue(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
        });
        socket.on("error", finish);
        socket.on("end", finish);
        socket.on("close", finish);
      },
      cancel() {
        closed = true;
        socket.destroy();
      },
    });
    return this.connect(stream, (bytes) => socket.write(bytes));
  }
}
