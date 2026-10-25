#!/usr/bin/env swift
// 发布日志便签富文本生成器（通用版）
// 从 argv[1] 读取 blocks JSON → NSAttributedString → RTFD + flat RTF 双类型写剪贴板
// 用法：swift stickies_release_rtf.swift <blocks.json>
// blocks.json 格式：[{"text": "...\n", "size": 14, "bold": true, "italic": false, "color": "title"}, ...]
// color 可选值：title / sub / head / black / blue / green（缺省 black）
// 随后按 references/release-sticky.md 执行 GUI：Cmd+N 新建 → 黄色 → Cmd+V 粘贴 → 定位
import AppKit
import Foundation

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> NSColor {
    return NSColor(calibratedRed: r/255, green: g/255, blue: b/255, alpha: 1)
}
let palette: [String: NSColor] = [
    "title": rgb(30, 40, 90),
    "sub":   rgb(95, 95, 105),
    "head":  rgb(200, 40, 40),
    "black": rgb(30, 30, 30),
    "blue":  rgb(40, 70, 200),
    "green": rgb(40, 150, 70),
]

guard CommandLine.arguments.count > 1 else {
    fputs("用法: swift stickies_release_rtf.swift <blocks.json>\n", stderr); exit(1)
}
let specURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let raw = try? Data(contentsOf: specURL),
      let arr = try? JSONSerialization.jsonObject(with: raw) as? [[String: Any]] else {
    fputs("blocks JSON 读取或解析失败: \(specURL.path)\n", stderr); exit(1)
}

func pingfang(_ size: CGFloat, _ bold: Bool, _ italic: Bool) -> NSFont {
    let fm = NSFontManager.shared
    var t: NSFontTraitMask = []
    if bold { t.insert(.boldFontMask) }
    if italic { t.insert(.italicFontMask) }
    return fm.font(withFamily: "PingFang SC", traits: t, weight: 0, size: size) ?? NSFont.systemFont(ofSize: size)
}

let doc = NSMutableAttributedString()
for item in arr {
    guard let text = item["text"] as? String else { continue }
    let size = CGFloat((item["size"] as? Double) ?? 12)
    let bold = (item["bold"] as? Bool) ?? false
    let italic = (item["italic"] as? Bool) ?? false
    let colorName = (item["color"] as? String) ?? "black"
    doc.append(NSAttributedString(string: text, attributes: [
        .font: pingfang(size, bold, italic),
        .foregroundColor: palette[colorName] ?? palette["black"]!
    ]))
}

let range = NSRange(location: 0, length: doc.length)
guard let rtfdData = try? doc.rtfd(from: range, documentAttributes: [:]),
      let rtfData = try? doc.rtf(from: range, documentAttributes: [:]) else {
    fputs("RTF/RTFD 生成失败\n", stderr); exit(1)
}
let pb = NSPasteboard.general
pb.clearContents()
pb.declareTypes([.rtfd, .rtf], owner: nil)
pb.setData(rtfdData, forType: .rtfd)
pb.setData(rtfData, forType: .rtf)
print("blocks=\(arr.count) | RTFD bytes=\(rtfdData.count) | flat RTF bytes=\(rtfData.count)")
print("剪贴板已写入 .rtfd + .rtf 双类型，执行 GUI 粘贴")
