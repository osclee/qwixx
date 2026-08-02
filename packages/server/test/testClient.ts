import WebSocket from "ws";

/**
 * Thin scripted client for driving the WS protocol in tests. Messages are
 * treated as a queue: each `waitFor` call scans forward from wherever the
 * previous call left off, so a sequence of `waitFor`s reads like a
 * conversation transcript instead of re-matching stale messages.
 */
export class TestClient {
  private messages: any[] = [];
  private cursor = 0;
  private pending: { predicate: (m: any) => boolean; resolve: (m: any) => void } | null = null;

  private constructor(private ws: WebSocket) {}

  static async connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const client = new TestClient(ws);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      client.messages.push(msg);
      if (client.pending && client.pending.predicate(msg)) {
        const { resolve } = client.pending;
        client.pending = null;
        client.cursor = client.messages.length;
        resolve(msg);
      }
    });
    return client;
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor(predicate: (m: any) => boolean, timeoutMs = 3000): Promise<any> {
    while (this.cursor < this.messages.length) {
      const m = this.messages[this.cursor];
      this.cursor++;
      if (predicate(m)) return m;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`waitFor timed out; last messages: ${JSON.stringify(this.messages.slice(-5))}`));
      }, timeoutMs);
      this.pending = {
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
    });
  }

  waitForSnapshot(predicate: (m: any) => boolean = () => true, timeoutMs = 3000): Promise<any> {
    return this.waitFor((m) => m.type === "snapshot" && predicate(m), timeoutMs);
  }

  waitForType(type: string, timeoutMs = 3000): Promise<any> {
    return this.waitFor((m) => m.type === type, timeoutMs);
  }

  close(): void {
    this.ws.close();
  }
}
