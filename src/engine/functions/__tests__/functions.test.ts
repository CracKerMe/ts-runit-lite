import { describe, expect, it } from "vitest";
import { evaluate } from "../../ExpressionEvaluator";
import { collectionFunctions } from "../collectionFunctions";
import { dateFunctions } from "../dateFunctions";
import { getFunctionCatalog } from "../index";
import { stringFunctions } from "../stringFunctions";
import { typeFunctions } from "../typeFunctions";

describe("stringFunctions", () => {
  it("uuid should generate a valid v4 uuid", () => {
    const id = stringFunctions.uuid.impl() as string;
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("base64Encode/base64Decode should round-trip", () => {
    const encoded = stringFunctions.base64Encode.impl("hello 世界") as string;
    expect(stringFunctions.base64Decode.impl(encoded)).toBe("hello 世界");
  });

  it("sha256 should hash deterministically", () => {
    expect(stringFunctions.sha256.impl("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("slugify should produce url-safe slugs", () => {
    expect(stringFunctions.slugify.impl("Hello World! 123")).toBe(
      "hello-world-123",
    );
  });

  it("truncate should cut long text with ellipsis", () => {
    expect(stringFunctions.truncate.impl("abcdefghij", 5)).toBe("abcde…");
    expect(stringFunctions.truncate.impl("abc", 5)).toBe("abc");
  });

  it("replace and split should work", () => {
    expect(stringFunctions.replace.impl("a-b-c", "-", "_")).toBe("a_b_c");
    expect(stringFunctions.split.impl("a,b,c", ",")).toEqual(["a", "b", "c"]);
  });
});

describe("collectionFunctions", () => {
  it("flatten should flatten nested arrays", () => {
    expect(collectionFunctions.flatten.impl([1, [2, [3]]])).toEqual([1, 2, 3]);
  });

  it("unique should deduplicate", () => {
    expect(collectionFunctions.unique.impl([1, 2, 2, 3, 1])).toEqual([1, 2, 3]);
  });

  it("chunk should split into pieces", () => {
    expect(collectionFunctions.chunk.impl([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
  });

  it("groupBy should group by field", () => {
    const items = [
      { cat: "a", v: 1 },
      { cat: "b", v: 2 },
      { cat: "a", v: 3 },
    ];
    const grouped = collectionFunctions.groupBy.impl(items, "cat") as Record<
      string,
      unknown[]
    >;
    expect(grouped.a).toHaveLength(2);
    expect(grouped.b).toHaveLength(1);
  });

  it("sortBy should sort by field with order", () => {
    const items = [{ p: 3 }, { p: 1 }, { p: 2 }];
    expect(collectionFunctions.sortBy.impl(items, "p", "desc")).toEqual([
      { p: 3 },
      { p: 2 },
      { p: 1 },
    ]);
  });

  it("pick and omit should select fields", () => {
    const obj = { a: 1, b: 2, secret: "x" };
    expect(collectionFunctions.pick.impl(obj, ["a", "b"])).toEqual({
      a: 1,
      b: 2,
    });
    expect(collectionFunctions.omit.impl(obj, ["secret"])).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("sum/avg/first/last/count should work", () => {
    expect(collectionFunctions.sum.impl([1, 2, 3])).toBe(6);
    expect(collectionFunctions.avg.impl([2, 4])).toBe(3);
    expect(collectionFunctions.first.impl([9, 8])).toBe(9);
    expect(collectionFunctions.last.impl([9, 8])).toBe(8);
    expect(collectionFunctions.count.impl([9, 8])).toBe(2);
  });
});

describe("typeFunctions", () => {
  it("toNumber/toBoolean should convert", () => {
    expect(typeFunctions.toNumber.impl("123.5")).toBe(123.5);
    expect(typeFunctions.toBoolean.impl("true")).toBe(true);
    expect(typeFunctions.toBoolean.impl("false")).toBe(false);
    expect(typeFunctions.toBoolean.impl(0)).toBe(false);
  });

  it("jsonStringify/jsonParse should round-trip", () => {
    const obj = { a: 1, b: [2, 3] };
    const s = typeFunctions.jsonStringify.impl(obj) as string;
    expect(typeFunctions.jsonParse.impl(s)).toEqual(obj);
  });

  it("isEmpty and defaultTo should work", () => {
    expect(typeFunctions.isEmpty.impl("")).toBe(true);
    expect(typeFunctions.isEmpty.impl([])).toBe(true);
    expect(typeFunctions.isEmpty.impl({})).toBe(true);
    expect(typeFunctions.isEmpty.impl("x")).toBe(false);
    expect(typeFunctions.defaultTo.impl(null, 5)).toBe(5);
    expect(typeFunctions.defaultTo.impl(7, 5)).toBe(7);
  });
});

describe("dateFunctions", () => {
  it("formatDate should format timestamps", () => {
    // 2026-07-07T08:09:05 UTC
    const ts = Date.UTC(2026, 6, 7, 8, 9, 5);
    expect(dateFunctions.formatDateUtc.impl(ts, "YYYY-MM-DD HH:mm:ss")).toBe(
      "2026-07-07 08:09:05",
    );
    expect(dateFunctions.formatDateUtc.impl(ts, "YYYY-MM-DD")).toBe(
      "2026-07-07",
    );
  });

  it("dateDiff should compute unit-based diff", () => {
    const start = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2026, 0, 3);
    expect(dateFunctions.dateDiff.impl(start, end, "days")).toBe(2);
    expect(dateFunctions.dateDiff.impl(start, end, "hours")).toBe(48);
  });

  it("startOfDay/endOfDay and isBefore/isAfter should work", () => {
    const ts = Date.UTC(2026, 6, 7, 8, 9, 5);
    const start = dateFunctions.startOfDayUtc.impl(ts) as number;
    const end = dateFunctions.endOfDayUtc.impl(ts) as number;
    expect(new Date(start).toISOString()).toBe("2026-07-07T00:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-07-07T23:59:59.999Z");
    expect(dateFunctions.isBefore.impl(start, end)).toBe(true);
    expect(dateFunctions.isAfter.impl(end, start)).toBe(true);
  });
});

describe("ExpressionEvaluator integration", () => {
  it("should call library functions through evaluate()", () => {
    expect(evaluate("sum(items)", { items: [1, 2, 3] })).toBe(6);
    expect(evaluate("truncate(name, 3)", { name: "abcdef" })).toBe("abc…");
    expect(evaluate("toNumber('42') + 1", {})).toBe(43);
    const id = evaluate("uuid()", {});
    expect(typeof id).toBe("string");
    expect(id).toHaveLength(36);
  });
});

describe("getFunctionCatalog", () => {
  it("should list functions with category and description", () => {
    const catalog = getFunctionCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(35);
    const uuid = catalog.find((f) => f.name === "uuid");
    expect(uuid).toBeDefined();
    expect(uuid?.category).toBe("string");
    expect(uuid?.description.length).toBeGreaterThan(0);
  });
});
