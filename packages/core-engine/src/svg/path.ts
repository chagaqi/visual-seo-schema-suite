/** SVG path-data tokenizer and minifier. */

const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

export interface PathSegment {
  command: string
  args: number[]
}

export class PathParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PathParseError"
  }
}

const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y

export function parsePath(d: string): PathSegment[] {
  const segments: PathSegment[] = []
  let i = 0
  const len = d.length
  let command: string | null = null

  const skipSeparators = () => {
    while (i < len && /[\s,]/.test(d[i]!)) i++
  }
  const readNumber = (): number => {
    skipSeparators()
    NUMBER_RE.lastIndex = i
    const m = NUMBER_RE.exec(d)
    if (!m || m.index !== i) throw new PathParseError(`Expected number at ${i} in path`)
    i = NUMBER_RE.lastIndex
    return parseFloat(m[0])
  }
  const readFlag = (): number => {
    skipSeparators()
    const ch = d[i]
    if (ch !== "0" && ch !== "1") throw new PathParseError(`Expected arc flag at ${i}`)
    i++
    return ch === "1" ? 1 : 0
  }

  while (i < len) {
    skipSeparators()
    if (i >= len) break
    const ch = d[i]!
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      command = ch
      i++
      if (ch === "z" || ch === "Z") {
        segments.push({ command: ch, args: [] })
        continue
      }
    } else if (!command) {
      throw new PathParseError("Path must start with a command")
    } else if (command === "z" || command === "Z") {
      throw new PathParseError("Numbers after Z without command")
    }
    const lower = command!.toLowerCase()
    const arity = ARITY[lower]!
    // Read one group of parameters; implicit repetition handled by the loop.
    const args: number[] = []
    for (let k = 0; k < arity; k++) {
      if (lower === "a" && (k === 3 || k === 4)) args.push(readFlag())
      else args.push(readNumber())
    }
    segments.push({ command: command!, args })
    // After a moveto, implicit repeats are linetos.
    if (command === "M") command = "L"
    else if (command === "m") command = "l"
    skipSeparators()
  }
  return segments
}

/** Format a number compactly: round, drop trailing zeros, strip leading zero, normalise -0. */
export function formatNumber(n: number, precision = 3): string {
  const factor = 10 ** precision
  let rounded = Math.round(n * factor) / factor
  if (Object.is(rounded, -0) || rounded === 0) rounded = 0
  let s = String(rounded)
  if (s.includes("e")) s = rounded.toFixed(precision).replace(/\.?0+$/, "")
  return s.replace(/^(-?)0\./, "$1.")
}

/** Serialise segments with minimal separators and implicit command repetition. */
export function stringifyPath(segments: PathSegment[], precision = 3): string {
  let out = ""
  let prevCommand = ""
  let lastNumber = ""
  for (const seg of segments) {
    const isMoveRepeat =
      (prevCommand === "M" && seg.command === "L") || (prevCommand === "m" && seg.command === "l")
    const repeat = seg.command === prevCommand && seg.command.toLowerCase() !== "m"
    if (!repeat && !isMoveRepeat) {
      out += seg.command
      lastNumber = ""
    }
    const isArc = seg.command.toLowerCase() === "a"
    seg.args.forEach((arg, idx) => {
      const s = isArc && (idx === 3 || idx === 4) ? String(arg) : formatNumber(arg, precision)
      // A separator is only needed when the next token could merge with the previous one.
      const needsSep =
        lastNumber !== "" && !s.startsWith("-") && !(s.startsWith(".") && /[.e]/.test(lastNumber))
      out += (needsSep ? " " : "") + s
      lastNumber = s
    })
    prevCommand = isMoveRepeat ? seg.command : seg.command
    if (seg.command === "z" || seg.command === "Z") lastNumber = ""
  }
  return out
}

export function minifyPathData(d: string, precision = 3): string {
  try {
    return stringifyPath(parsePath(d), precision)
  } catch {
    // Never corrupt a path we can't fully understand.
    return d.trim().replace(/\s+/g, " ")
  }
}
