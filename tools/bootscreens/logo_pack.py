# MTK logo partition packer for the TB-7304X.
# Layout: 0x200-byte MTK header (magic 0x58881688, u32 blob size at +4, name "logo", rest kept as-is),
# then the blob: u32 count, u32 blob size, u32 offsets[count] (relative to the blob), then one
# zlib stream per image. Each full-screen image is raw BGRA 600x1024 in panel orientation (portrait).
#
#   python -I logo_pack.py roundtrip stock.bin                      # repack unchanged, must match byte for byte
#   python -I logo_pack.py replace stock.bin out.bin IDX=img.png ... # img.png: 1024x600 landscape (desk view)
import struct, sys, zlib
from PIL import Image

HDR = 0x200

def unpack(path):
    b = open(path, 'rb').read()
    magic, size = struct.unpack_from('<II', b, 0)
    assert magic == 0x58881688, hex(magic)
    d = b[HDR:HDR + size]
    n, total = struct.unpack_from('<II', d, 0)
    assert total == size, (total, size)
    offs = [struct.unpack_from('<I', d, 8 + 4 * i)[0] for i in range(n)] + [total]
    return b[:HDR], [d[offs[i]:offs[i + 1]] for i in range(n)]

def pack(header, chunks):
    n = len(chunks)
    table = 8 + 4 * n
    offs, o = [], table
    for c in chunks:
        offs.append(o); o += len(c)
    total = o
    blob = struct.pack('<II', n, total) + b''.join(struct.pack('<I', x) for x in offs) + b''.join(chunks)
    hdr = bytearray(header); struct.pack_into('<I', hdr, 4, total)
    return bytes(hdr) + blob

def landscape_to_panel(img):
    # Desk view (1024x600) -> panel (600x1024). From kiosk/tap.sh: panel (px, py) = (599 - ly, lx).
    img = img.convert('RGBA')
    assert img.size == (1024, 600), img.size
    p = img.transpose(Image.Transpose.ROTATE_270)      # (lx, ly) -> (599 - ly, lx), checked by check_rotation()
    assert p.size == (600, 1024)
    return p

def check_rotation():
    L = Image.new('RGBA', (1024, 600), (0, 0, 0, 255))
    L.putpixel((10, 20), (255, 0, 0, 255))           # landscape lx=10, ly=20
    P = landscape_to_panel(L)
    want = (599 - 20, 10)                              # panel px=579, py=10
    got = [(x, y) for x in range(600) for y in range(1024) if P.getpixel((x, y))[0] == 255]
    return got == [want], got, want

def encode(img_panel):
    r, g, b, a = img_panel.split()
    raw = Image.merge('RGBA', (b, g, r, Image.new('L', img_panel.size, 255))).tobytes()   # BGRA, opaque
    return zlib.compress(raw, 9)

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'roundtrip':
        hdr, chunks = unpack(sys.argv[2])
        out = pack(hdr, chunks)
        orig = open(sys.argv[2], 'rb').read()[:len(out)]
        print('roundtrip identical:', out == orig, len(out), 'bytes;', len(chunks), 'images')
        print('rotation:', check_rotation())
    elif cmd == 'replace':
        ok, got, want = check_rotation(); assert ok, (got, want)
        hdr, chunks = unpack(sys.argv[2])
        for arg in sys.argv[4:]:
            idx, path = arg.split('=', 1)
            chunks[int(idx)] = encode(landscape_to_panel(Image.open(path)))
            print('image', idx, '<-', path)
        out = pack(hdr, chunks)
        assert len(out) <= 8 * 1024 * 1024, 'does not fit the 8 MiB logo partition'
        open(sys.argv[3], 'wb').write(out)
        # verify: re-read and decode every image
        _, back = unpack(sys.argv[3])
        sizes = [len(zlib.decompress(c)) for c in back]
        print('wrote', sys.argv[3], len(out), 'bytes; decoded sizes ok:', sizes == [len(zlib.decompress(c)) for c in chunks])
