export type MathNode =
  | { kind: "number"; value: number }
  | { kind: "x" }
  | { kind: "unary"; op: "+" | "-"; value: MathNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: MathNode; right: MathNode }
  | { kind: "function"; name: string; value: MathNode };

type Token = { type: "number" | "name" | "op" | "paren"; value: string };

const FUNCTIONS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, log10: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
};

const tokenize = (source: string): Token[] => {
  const cleaned = source
    .replace(/[−–]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/")
    .replace(/π/g, "pi").replace(/(\d),(\d)/g, "$1.$2")
    .replace(/^\s*(?:f\s*\(\s*x\s*\)|y)\s*=\s*/i, "");
  const tokens: Token[] = [];
  const re = /\s*(\d+(?:\.\d*)?|\.\d+|[A-Za-z]+|[()+\-*/^,])/gy;
  let offset = 0;
  while (offset < cleaned.length) {
    re.lastIndex = offset;
    const match = re.exec(cleaned);
    if (!match) {
      if (/^\s*$/.test(cleaned.slice(offset))) break;
      throw new Error(`Unbekanntes Zeichen „${cleaned[offset]}“`);
    }
    const value = match[1], lower = value.toLowerCase();
    const type: Token["type"] = /^\d|^\./.test(value) ? "number" : /^[a-z]/i.test(value) ? "name" : value === "(" || value === ")" ? "paren" : "op";
    tokens.push({ type, value: type === "name" ? lower : value });
    offset = re.lastIndex;
  }
  const expanded: Token[] = [];
  const endsAtom = (t?: Token) => !!t && (t.type === "number" || (t.type === "name" && ["x", "pi", "e"].includes(t.value)) || t.value === ")");
  const startsAtom = (t?: Token) => !!t && (t.type === "number" || (t.type === "name" && (["x", "pi", "e"].includes(t.value) || !!FUNCTIONS[t.value])) || t.value === "(");
  for (const token of tokens) {
    const prev = expanded[expanded.length - 1];
    if (endsAtom(prev) && startsAtom(token)) expanded.push({ type: "op", value: "*" });
    expanded.push(token);
  }
  return expanded;
};

export const parseMathExpression = (source: string): MathNode => {
  const tokens = tokenize(source);
  if (!tokens.length) throw new Error("Gib eine Funktion ein, zum Beispiel x^2 oder sin(x).");
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const expect = (value: string) => { if (take()?.value !== value) throw new Error(`„${value}“ fehlt.`); };

  const expression = (): MathNode => {
    let node = product();
    while (peek()?.value === "+" || peek()?.value === "-") {
      const op = take().value as "+" | "-"; node = { kind: "binary", op, left: node, right: product() };
    }
    return node;
  };
  const product = (): MathNode => {
    let node = unary();
    while (peek()?.value === "*" || peek()?.value === "/") {
      const op = take().value as "*" | "/"; node = { kind: "binary", op, left: node, right: unary() };
    }
    return node;
  };
  const unary = (): MathNode => {
    if (peek()?.value === "+" || peek()?.value === "-") return { kind: "unary", op: take().value as "+" | "-", value: unary() };
    return power();
  };
  const power = (): MathNode => {
    const left = primary();
    return peek()?.value === "^" ? (take(), { kind: "binary", op: "^", left, right: unary() }) : left;
  };
  const primary = (): MathNode => {
    const token = take();
    if (!token) throw new Error("Nach einem Rechenzeichen fehlt ein Wert.");
    if (token.type === "number") {
      const value = Number(token.value); if (!Number.isFinite(value)) throw new Error("Diese Zahl kann ich nicht lesen.");
      return { kind: "number", value };
    }
    if (token.value === "(") { const node = expression(); expect(")"); return node; }
    if (token.type === "name") {
      if (token.value === "x") return { kind: "x" };
      if (token.value === "pi") return { kind: "number", value: Math.PI };
      if (token.value === "e") return { kind: "number", value: Math.E };
      if (FUNCTIONS[token.value]) { expect("("); const value = expression(); expect(")"); return { kind: "function", name: token.value, value }; }
      throw new Error(`„${token.value}“ wird noch nicht unterstützt.`);
    }
    throw new Error(`Unerwartetes Zeichen „${token.value}“`);
  };

  const tree = expression();
  if (pos !== tokens.length) throw new Error(`„${tokens[pos].value}“ konnte nicht zugeordnet werden.`);
  return tree;
};

export const evaluateMathExpression = (node: MathNode, x: number): number => {
  switch (node.kind) {
    case "number": return node.value;
    case "x": return x;
    case "unary": return node.op === "-" ? -evaluateMathExpression(node.value, x) : evaluateMathExpression(node.value, x);
    case "function": return FUNCTIONS[node.name](evaluateMathExpression(node.value, x));
    case "binary": {
      const a = evaluateMathExpression(node.left, x), b = evaluateMathExpression(node.right, x);
      if (node.op === "+") return a + b;
      if (node.op === "-") return a - b;
      if (node.op === "*") return a * b;
      if (node.op === "/") return Math.abs(b) < 1e-14 ? NaN : a / b;
      return Math.pow(a, b);
    }
  }
};

export const functionExpressionFromText = (text: string): string | null => {
  const match = text.match(/(?:^|\n)\s*(?:f\s*\(\s*x\s*\)|y)\s*=\s*([^\n]+)/i);
  return match?.[1]?.trim() || null;
};
