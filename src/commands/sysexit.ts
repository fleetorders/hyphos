/**
 * A tiny error type for bail-out exits with a message.
 *
 * Several helpers abort deep in the call stack by throwing it; the local web
 * server catches the throw and turns it into an HTTP 502, while the
 * command-line path prints the message to stderr and exits with status 1.
 */
export class SysExit extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SysExit";
  }
}
