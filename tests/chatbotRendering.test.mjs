import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseAssistantMessage } from "../src/app/utils/assistantMessage.js";

test("Markdown tables become readable category rows rather than raw pipe text", () => {
  const blocks = parseAssistantMessage([
    "| Category | Services |",
    "| --- | --- |",
    "| Grooming | Basic Groom, Bath & Blow-dry |",
    "| Veterinary | Consultation |",
  ].join("\n"));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "table");
  assert.deepEqual(blocks[0].rows, [
    { title: "Grooming", details: [{ label: "Services", value: "Basic Groom, Bath & Blow-dry" }] },
    { title: "Veterinary", details: [{ label: "Services", value: "Consultation" }] },
  ]);
  assert.ok(!JSON.stringify(blocks).includes("|"));
});

test("headings, bold text, and both list styles remain structured and readable", () => {
  assert.deepEqual(parseAssistantMessage("## Grooming\n\nAsk about **Basic Groom**.\n\n- Bath\n- Full Groom\n\n1. Choose a service\n2. Book online"), [
    { type: "heading", level: 2, text: "Grooming" },
    { type: "paragraph", text: "Ask about **Basic Groom**." },
    { type: "ul", items: ["Bath", "Full Groom"] },
    { type: "ol", items: ["Choose a service", "Book online"] },
  ]);
});

test("assistant content remains text data and both chat surfaces constrain horizontal overflow", () => {
  const component = readFileSync(new URL("../src/app/components/AssistantMessage.jsx", import.meta.url), "utf8");
  const floating = readFileSync(new URL("../src/app/components/AskLlamaAI.jsx", import.meta.url), "utf8");
  const embedded = readFileSync(new URL("../src/app/components/ChatbotWidget.jsx", import.meta.url), "utf8");
  assert.ok(!component.includes("dangerouslySetInnerHTML"));
  assert.ok(floating.includes("overflow-x-hidden"));
  assert.ok(floating.includes("flex-wrap"));
  assert.ok(embedded.includes("overflow-x-hidden"));
});
