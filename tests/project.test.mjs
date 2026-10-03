import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSrt,
  formatSrt,
  parseGlossary,
  splitText,
  run,
} from "../project.mjs";
import { ValidationError } from "../lib/validate.mjs";

const payload = {
  text: "Hello.\n\nThank you.",
  source: "auto",
  target: "简体中文",
  tone: "natural",
  format: "text",
  glossary: "",
};
const demo = {
  mode: "demo",
  generate: async (spec) => ({ data: await spec.demo() }),
};
const subtitle =
  "001\r\n00:00:01,050 --> 00:00:03,200\r\n<i>Hello.</i>\r\nSecond line\r\n\r\n002\r\n00:00:04,000 --> 00:00:05,500\r\n<script>alert(1)</script>";

test("SRT parsing preserves original numbers, exact timestamps, multiple lines and literal tags", () => {
  const cues = parseSrt(subtitle);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].number, "001");
  assert.equal(cues[0].time, "00:00:01,050 --> 00:00:03,200");
  assert.equal(cues[0].text, "<i>Hello.</i>\nSecond line");
  assert.equal(cues[1].text, "<script>alert(1)</script>");
  assert.deepEqual(parseSrt(formatSrt(cues)), cues);
});

test("SRT rejects invalid ranges, malformed timestamps, duplicate numbers and incomplete cues", () => {
  for (const value of [
    "1\n00:00:02,000 --> 00:00:01,000\na",
    "1\n00:60:00,000 --> 01:00:01,000\na",
    "1\n00:00:01.000 --> 00:00:02.000\na",
    "0\n00:00:01,000 --> 00:00:02,000\na",
    "1\n00:00:01,000 --> 00:00:02,000",
    "1\n00:00:01,000 --> 00:00:02,000\na\n\n1\n00:00:03,000 --> 00:00:04,000\nb",
  ])
    assert.throws(() => parseSrt(value), ValidationError);
  assert.throws(
    () =>
      formatSrt([
        { number: "1", time: "00:00:01,000 --> 00:00:02,000", text: "a\n\nb" },
      ]),
    /空行/,
  );
});

test("glossary trims entries, handles empty content, and rejects duplicate or malformed terms", () => {
  assert.deepEqual(parseGlossary(" API = 接口 \n\n user = 用户 "), [
    { source: "API", target: "接口" },
    { source: "user", target: "用户" },
  ]);
  assert.deepEqual(parseGlossary(""), []);
  for (const value of [
    "API = 接口\napi = 别的词",
    "missing delimiter",
    "a =",
    "= b",
    "a=b=c",
    Array.from({ length: 41 }, (_, index) => `a${index}=b`).join("\n"),
  ])
    assert.throws(() => parseGlossary(value), ValidationError);
});

test("text splitting preserves a whole long paragraph and validates count and input boundaries", async () => {
  const long = "x".repeat(15000);
  assert.equal(splitText(long)[0].source, long);
  assert.equal(splitText("first\nsecond\n\nthird").length, 2);
  assert.throws(() => splitText("x".repeat(15001)), ValidationError);
  assert.throws(
    () => splitText(Array(101).fill("a").join("\n\n")),
    ValidationError,
  );
  for (const change of [
    { text: "" },
    { source: "Spanish" },
    { target: "invalid" },
    { tone: "invalid" },
    { format: "html" },
    { glossary: "x".repeat(3001) },
  ])
    await assert.rejects(run({ ...payload, ...change }, demo), ValidationError);
});

test("live translation contract treats inputs as data and restores reordered result IDs", async () => {
  let observed;
  const result = await run(payload, {
    mode: "live",
    generate: async (spec) => {
      observed = spec;
      return {
        data: {
          segments: [
            { id: "segment-2", translation: "谢谢。" },
            { id: "segment-1", translation: "你好。" },
          ],
        },
      };
    },
  });
  assert.equal(result.translation, "你好。\n\n谢谢。");
  assert.deepEqual(
    result.segments.map((segment) => segment.source),
    ["Hello.", "Thank you."],
  );
  assert.match(observed.instructions, /untrusted data/);
  assert.deepEqual(JSON.parse(observed.input).glossary, []);
  assert.equal(observed.schema.properties.segments.minItems, 2);
  assert.deepEqual(result.warnings, []);
});

test("model output cannot omit, duplicate or invent segments", async () => {
  for (const segments of [
    [{ id: "segment-1", translation: "a" }],
    [
      { id: "segment-1", translation: "a" },
      { id: "segment-1", translation: "b" },
    ],
    [
      { id: "segment-1", translation: "a" },
      { id: "unknown", translation: "b" },
    ],
    [
      { id: "segment-1", translation: "a" },
      { id: "segment-2", translation: " " },
    ],
  ])
    await assert.rejects(
      run(payload, {
        mode: "live",
        generate: async () => ({ data: { segments } }),
      }),
      ValidationError,
    );
});

test("SRT model handles only cue text while local metadata and glossary warnings stay reliable", async () => {
  const result = await run(
    {
      ...payload,
      text: "007\n00:01:01,000 --> 00:01:03,000\nUse the API.",
      format: "srt",
      glossary: "api = 接口",
    },
    {
      mode: "live",
      generate: async (spec) => {
        const input = JSON.parse(spec.input);
        assert.deepEqual(input.segments, [
          { id: "cue-1", source: "Use the API." },
        ]);
        assert.ok(!spec.input.includes("00:01:01"));
        return {
          data: { segments: [{ id: "cue-1", translation: "使用这个服务。" }] },
        };
      },
    },
  );
  assert.match(result.translation, /^007\n00:01:01,000 --> 00:01:03,000\n/);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /接口/);
});

test("demo uses known examples, literal glossary substitutions and clearly marked unknown previews", async () => {
  const known = await run(payload, demo);
  assert.equal(known.translation, "你好。\n\n谢谢。");
  assert.match(known.warnings[0], /不能视为真实翻译/);
  const unknown = await run(
    {
      ...payload,
      text: "New API proposal with $& symbols.",
      glossary: "API = 接口",
    },
    demo,
  );
  assert.match(unknown.translation, /【演示：原文预览】New 接口 proposal/);
  assert.ok(unknown.translation.includes("$&"));
  assert.equal(unknown.warnings.length, 1);
  const sample = await run(
    {
      ...payload,
      text: "Welcome to your workspace.\n\nYour privacy matters.",
      glossary: "workspace = 工作区\nprivacy = 隐私",
    },
    demo,
  );
  assert.equal(sample.translation, "欢迎来到你的工作区。\n\n你的隐私很重要。");
  assert.equal(sample.warnings.length, 1);
});
