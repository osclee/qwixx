import { describe, expect, it } from "vitest";
import {
  CLIENT_MESSAGE_TYPES as serverClientTypes,
  SERVER_MESSAGE_TYPES as serverServerTypes,
} from "../src/protocol.js";
import {
  CLIENT_MESSAGE_TYPES as clientClientTypes,
  SERVER_MESSAGE_TYPES as clientServerTypes,
} from "../../client/src/net/protocol.js";

/**
 * Guards against packages/server/src/protocol.ts (zod-validated, the source
 * of truth) and packages/client/src/net/protocol.ts (hand-mirrored, no
 * runtime validation) silently diverging -- see CLAUDE.md.
 *
 * This only checks that both files agree on the *set of message type names*
 * in each direction. It says nothing about whether the fields on a given
 * message still match between the two -- that's field-level drift, and it
 * still needs manual review whenever either protocol.ts changes.
 */
describe("client/server protocol sync", () => {
  it("agree on client -> server message types", () => {
    expect([...clientClientTypes].sort()).toEqual([...serverClientTypes].sort());
  });

  it("agree on server -> client message types", () => {
    expect([...clientServerTypes].sort()).toEqual([...serverServerTypes].sort());
  });
});
