import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil),
      let art = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fatalError("read \(a[1])") }
let size = 1024
guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpace(name: CGColorSpace.sRGB)!,
                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fatalError("ctx") }
ctx.setFillColor(red: 0xfb/255, green: 0xf3/255, blue: 0xe4/255, alpha: 1)
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
// The source art already has its own margin.
let inset = 0.0
ctx.draw(art, in: CGRect(x: inset, y: inset, width: Double(size) - 2 * inset, height: Double(size) - 2 * inset))
guard let out = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("write") }
CGImageDestinationAddImage(dest, out, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("finalize") }
