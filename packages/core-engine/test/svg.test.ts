import { describe, expect, it } from "vitest"
import { formatNumber, isLikelySvg, minifyColor, minifyPathData, minifySvg, parsePath, parseSvg, serializeSvg } from "../src/index.ts"

const ILLUSTRATOR_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
  x="0px" y="0px" width="24.000000px" height="24px" xml:space="preserve" enable-background="new 0 0 24 24">
  <title>Search</title>
  <desc>Created with Sketch.</desc>
  <metadata><rdf:RDF></rdf:RDF></metadata>
  <sodipodi:namedview id="base" pagecolor="#ffffff"/>
  <g>
    <g id="Icons" inkscape:label="Icons">
      <path fill="#FFFFFF" stroke="rgb(0, 0, 0)" d="M 10.000000 2.000000 C 5.581722 2.000000 2.000000 5.581722 2.000000 10.000000 L 2.000000 10.500000 Z" data-name="Path 1"/>
      <circle cx="12.0000" cy="12.0000" r="3.33333333" fill="#ff0000" opacity="0.50"/>
    </g>
  </g>
  <g></g>
</svg>`

describe("path data", () => {
  it("parses implicit commands and arc flags", () => {
    const segs = parsePath("M0 0 10 10a5 5 0 011 1z")
    expect(segs.map((s) => s.command)).toEqual(["M", "L", "a", "z"])
    expect(segs[2]!.args).toEqual([5, 5, 0, 0, 1, 1, 1])
  })
  it("minifies numbers and separators", () => {
    expect(minifyPathData("M 10.000000 2.000000 L -0.500 0.250 L 0.1 0.2 Z")).toBe("M10 2-.5.25.1.2Z")
    expect(minifyPathData("M0,0 L5,5 L5,10 z")).toBe("M0 0 5 5 5 10z")
    expect(minifyPathData("M1.23456 0", 2)).toBe("M1.23 0")
  })
  it("keeps a separator between integers and fractions", () => {
    expect(minifyPathData("M 5 0.5")).toBe("M5 .5")
  })
  it("never corrupts unparseable paths", () => {
    expect(minifyPathData("M 0 0 L foo")).toBe("M 0 0 L foo")
  })
  it("formats numbers", () => {
    expect(formatNumber(0.5)).toBe(".5")
    expect(formatNumber(-0.0001)).toBe("0")
    expect(formatNumber(3.33333)).toBe("3.333")
    expect(formatNumber(12)).toBe("12")
  })
})

describe("minifyColor", () => {
  it("shortens colors", () => {
    expect(minifyColor("#FFFFFF")).toBe("#fff")
    expect(minifyColor("rgb(255, 0, 0)")).toBe("red")
    expect(minifyColor("#d2b48c")).toBe("tan")
    expect(minifyColor("url(#grad)")).toBe("url(#grad)")
    expect(minifyColor("none")).toBe("none")
    expect(minifyColor("currentcolor")).toBe("currentColor")
  })
})

describe("parser", () => {
  it("round-trips a simple document", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><text x="1">Hi &amp; bye</text></svg>`
    expect(serializeSvg(parseSvg(src))).toBe(src)
  })
  it("rejects unclosed elements", () => {
    expect(() => parseSvg("<svg><g>")).toThrow()
  })
})

describe("minifySvg", () => {
  it("strips editor cruft and saves bytes", () => {
    const r = minifySvg(ILLUSTRATOR_SVG)
    expect(r.svg.startsWith("<svg")).toBe(true)
    expect(r.svg).not.toMatch(/<\?xml|<!DOCTYPE|<!--|inkscape|sodipodi|metadata|<desc|data-name|xml:space|enable-background|version=/)
    expect(r.svg).not.toContain("xmlns:xlink") // unused
    expect(r.svg).toContain("<title>Search</title>") // a11y preserved
    expect(r.svg).toContain('viewBox="0 0 24 24"')
    expect(r.svg).toContain('d="M10 2C5.582 2 2 5.582 2 10L2 10.5Z"')
    expect(r.svg).toContain('fill="#fff"')
    expect(r.svg).toContain('stroke="#000"')
    expect(r.svg).toContain('r="3.333"')
    expect(r.svg).toContain('opacity=".5"')
    expect(r.svg).not.toContain("<g></g>")
    expect(r.svg).not.toContain('id="Layer_1"')
    expect(r.savingsPercent).toBeGreaterThan(50)
    expect(r.minifiedBytes).toBeLessThan(r.originalBytes)
  })

  it("sanitizes scripts, handlers and javascript: URLs", () => {
    const r = minifySvg(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect width="1" height="1"/></a><foreignObject><div/></foreignObject></svg>`,
    )
    expect(r.svg).not.toMatch(/alert|script|onload|foreignObject|javascript/)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it("keeps referenced ids and xlink when used", () => {
    const r = minifySvg(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#FF0000"/></linearGradient></defs><rect fill="url(#g)" width="10" height="10"/><use xlink:href="#g"/></svg>`,
    )
    expect(r.svg).toContain('id="g"')
    expect(r.svg).toContain("xmlns:xlink")
    expect(r.svg).toContain('stop-color="red"')
  })

  it("supports responsive, title removal and aria options", () => {
    const r = minifySvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><title>X</title><rect width="10" height="10"/></svg>`, {
      responsive: true,
      keepTitle: false,
      ariaLabel: "Company logo",
    })
    expect(r.svg).not.toContain("width=\"10\" height=\"10\"><")
    expect(r.svg).toContain('viewBox="0 0 10 10"')
    expect(r.svg).not.toContain("<title>")
    expect(r.svg).toContain('role="img"')
    expect(r.svg).toContain('aria-label="Company logo"')
    const hidden = minifySvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`, { ariaLabel: "" })
    expect(hidden.svg).toContain('aria-hidden="true"')
  })

  it("minifies <style> and preserves text whitespace", () => {
    const r = minifySvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><style>/* c */ .a { fill : #FFFFFF ; }</style><text class="a">Hello  world</text></svg>`,
    )
    expect(r.svg).toContain("<style>.a{fill:#fff}</style>")
    expect(r.svg).toContain("Hello  world")
  })

  it("is idempotent", () => {
    const once = minifySvg(ILLUSTRATOR_SVG).svg
    expect(minifySvg(once).svg).toBe(once)
  })

  it("throws without an svg root and detects svg strings", () => {
    expect(() => minifySvg("<div></div>")).toThrow(/svg/)
    expect(isLikelySvg("<svg></svg>")).toBe(true)
    expect(isLikelySvg("<div/>")).toBe(false)
  })
})
