#!/usr/bin/env node
/**
 * Field-level drift checker for the two hand-mirrored protocol.ts files
 * (packages/server/src/protocol.ts, zod-validated source of truth, and
 * packages/client/src/net/protocol.ts, plain-TS mirror). CLAUDE.md documents
 * that these must be kept in sync by hand, and the server test suite
 * (test/protocolSync.test.ts) already checks that both sides agree on the
 * *set of message type names* -- but that test explicitly says it "says
 * nothing about whether the fields on a given message still match between
 * the two." This script fills exactly that gap.
 *
 * It parses both files with the TypeScript compiler API (no type-checking,
 * just AST walking -- fast, and needs no tsconfig/project setup) and
 * compares, per message:
 *   - Client -> Server: each server `z.object({...})` message schema against
 *     the matching member of the client's `ClientMessage` union, matched by
 *     their shared `type` string literal.
 *   - Server -> Client: every named interface that appears in BOTH files
 *     (SnapshotMessage, PublicSheet, etc.), matched by name.
 *
 * Scope: TOP-LEVEL FIELD NAMES ONLY, one level deep. It does not check field
 * types, and does not recurse into nested shapes like `submit_white`'s
 * `action` union -- those still need a manual read of both files, same as
 * before. What it reliably catches is the most common real drift: a field
 * added, removed, or renamed on one side and forgotten on the other.
 *
 * Exit code 0 = no drift found, 1 = drift found (or a file failed to parse),
 * so this doubles as a scriptable pre-PR check, not just an interactive one.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "packages/server/src/protocol.ts")))
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--server") flags.server = argv[++i];
    else if (argv[i] === "--client") flags.client = argv[++i];
  }
  return flags;
}

function loadSourceFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

/** True if `node` is a call expression whose callee text is exactly `qualifiedName` (e.g. "z.object"). */
function isCallTo(node, qualifiedName) {
  return (
    ts.isCallExpression(node) && node.expression.getText() === qualifiedName
  );
}

/**
 * Server side: every `export const xxxMsg = z.object({ type: z.literal("foo"), ... })`
 * becomes messageType -> Set(field names, excluding "type").
 */
function extractServerZodMessages(sourceFile) {
  const result = new Map();
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer || !isCallTo(decl.initializer, "z.object"))
        continue;
      const arg = decl.initializer.arguments[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) continue;

      let messageType = null;
      const fields = new Set();
      for (const prop of arg.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name))
          continue;
        const fieldName = prop.name.text;
        if (fieldName === "type" && isCallTo(prop.initializer, "z.literal")) {
          const litArg = prop.initializer.arguments[0];
          if (litArg && ts.isStringLiteral(litArg)) messageType = litArg.text;
          continue;
        }
        fields.add(fieldName);
      }
      if (messageType) result.set(messageType, fields);
    }
  }
  return result;
}

/**
 * Client side: the `ClientMessage` union type, each member a type literal
 * like `{ type: "foo"; a: string }`, becomes messageType -> Set(field names).
 */
function extractClientMessageUnion(sourceFile) {
  const result = new Map();
  for (const stmt of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== "ClientMessage")
      continue;
    if (!ts.isUnionTypeNode(stmt.type)) continue;
    for (const member of stmt.type.types) {
      const literal = ts.isParenthesizedTypeNode(member) ? member.type : member;
      if (!ts.isTypeLiteralNode(literal)) continue;

      let messageType = null;
      const fields = new Set();
      for (const member2 of literal.members) {
        if (!ts.isPropertySignature(member2) || !ts.isIdentifier(member2.name))
          continue;
        const fieldName = member2.name.text;
        if (
          fieldName === "type" &&
          member2.type &&
          ts.isLiteralTypeNode(member2.type) &&
          ts.isStringLiteral(member2.type.literal)
        ) {
          messageType = member2.type.literal.text;
          continue;
        }
        fields.add(fieldName);
      }
      if (messageType) result.set(messageType, fields);
    }
  }
  return result;
}

/** Every top-level `export interface Name { ... }`, name -> Set(member names, one level deep). */
function extractInterfaces(sourceFile) {
  const result = new Map();
  for (const stmt of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(stmt)) continue;
    const fields = new Set();
    for (const member of stmt.members) {
      if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
        fields.add(member.name.text);
      }
    }
    result.set(stmt.name.text, fields);
  }
  return result;
}

function diffSets(a, b) {
  const onlyInA = [...a].filter((x) => !b.has(x)).sort();
  const onlyInB = [...b].filter((x) => !a.has(x)).sort();
  return { onlyInA, onlyInB };
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(scriptDir) ?? findRepoRoot(process.cwd());
  if (!repoRoot) {
    console.error(
      "error: couldn't locate the qwixx repo root (looked for packages/server/src/protocol.ts) " +
        "-- pass --server and --client explicitly if the repo layout changed.",
    );
    process.exit(1);
  }

  const flags = parseArgs(process.argv.slice(2));
  const serverPath =
    flags.server ?? path.join(repoRoot, "packages/server/src/protocol.ts");
  const clientPath =
    flags.client ?? path.join(repoRoot, "packages/client/src/net/protocol.ts");

  if (!fs.existsSync(serverPath)) {
    console.error(`error: server protocol file not found: ${serverPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(clientPath)) {
    console.error(`error: client protocol file not found: ${clientPath}`);
    process.exit(1);
  }

  const serverSource = loadSourceFile(serverPath);
  const clientSource = loadSourceFile(clientPath);

  const serverMessages = extractServerZodMessages(serverSource);
  const clientMessages = extractClientMessageUnion(clientSource);
  const serverInterfaces = extractInterfaces(serverSource);
  const clientInterfaces = extractInterfaces(clientSource);

  let problems = 0;

  console.log(
    "Client -> Server messages (zod schema vs. ClientMessage union member):\n",
  );
  const messageTypes = new Set([
    ...serverMessages.keys(),
    ...clientMessages.keys(),
  ]);
  for (const type of [...messageTypes].sort()) {
    const serverFields = serverMessages.get(type);
    const clientFields = clientMessages.get(type);
    if (!serverFields) {
      console.log(
        `  ✗ "${type}": in client's ClientMessage union but no matching z.object in server protocol.ts`,
      );
      problems++;
      continue;
    }
    if (!clientFields) {
      console.log(
        `  ✗ "${type}": defined in server protocol.ts but missing from client's ClientMessage union`,
      );
      problems++;
      continue;
    }
    const { onlyInA, onlyInB } = diffSets(serverFields, clientFields);
    if (onlyInA.length === 0 && onlyInB.length === 0) {
      console.log(`  ✓ "${type}"`);
    } else {
      problems++;
      console.log(`  ✗ "${type}"`);
      if (onlyInA.length)
        console.log(`      only in server: ${onlyInA.join(", ")}`);
      if (onlyInB.length)
        console.log(`      only in client: ${onlyInB.join(", ")}`);
    }
  }

  const sharedInterfaceNames = [...serverInterfaces.keys()].filter((name) =>
    clientInterfaces.has(name),
  );
  console.log(
    `\nServer -> Client interfaces shared by both files (${sharedInterfaceNames.length} found):\n`,
  );
  for (const name of sharedInterfaceNames.sort()) {
    const { onlyInA, onlyInB } = diffSets(
      serverInterfaces.get(name),
      clientInterfaces.get(name),
    );
    if (onlyInA.length === 0 && onlyInB.length === 0) {
      console.log(`  ✓ ${name}`);
    } else {
      problems++;
      console.log(`  ✗ ${name}`);
      if (onlyInA.length)
        console.log(`      only in server: ${onlyInA.join(", ")}`);
      if (onlyInB.length)
        console.log(`      only in client: ${onlyInB.join(", ")}`);
    }
  }

  console.log();
  if (problems === 0) {
    console.log(
      "No field-level drift found. (This only checks top-level field names -- see the header comment for scope.)",
    );
    process.exit(0);
  } else {
    console.log(`${problems} mismatch(es) found above.`);
    process.exit(1);
  }
}

main();
