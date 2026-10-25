"""
Rebuilds src/lib/assets/noto-sans-jp.otf: Noto Sans JP Regular with its ideographs cut to JIS X 0208.

  nix shell --impure --expr 'with import (builtins.getFlake "nixpkgs") {}; python3.withPackages (p: [p.fonttools])' \
    -c python3 scripts/cjk-font.py

The cut is for the subtitle worker's memory more than for the download: adding a face grows jassub's wasm
memory by far more than the file. Measured on Chrome 155 and jassub 2.5.23, an episode with six attached
fonts at its opening song: 38.4 MiB without a CJK face, 97.1 MiB with the full 4.5 MB font, 193.4 MiB with
the same font as woff2, 65.1 MiB with this 2.4 MB cut. JIS X 0208 holds the 6,355 kanji Japanese text
uses; Chinese-only hanzi and Hangul are not in it.

The face also joins the Liberation Sans family, through a second family name in another language. libass
looks for a glyph a style's face lacks in its default family only, which is jassub's Liberation Sans, and
within a family it takes the first face that has the glyph. So once this face is loaded after Liberation
Sans, it draws exactly what Liberation Sans cannot and nothing else.
"""

import hashlib
import io
import urllib.request
from fontTools import subset
from fontTools.ttLib import TTFont

SOURCE = 'https://raw.githubusercontent.com/notofonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf'
SHA256 = 'dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073'
OUT = 'src/lib/assets/noto-sans-jp.otf'
IDEOGRAPHS = [(0x3400, 0x4dbf), (0x4e00, 0x9fff), (0xf900, 0xfaff), (0x20000, 0x3ffff)]


def in_jis_x_0208(cp):
    try:
        chr(cp).encode('shift_jis')
        return True
    except UnicodeEncodeError:
        return False


def kept(cp):
    return in_jis_x_0208(cp) or not any(a <= cp <= b for a, b in IDEOGRAPHS)


data = urllib.request.urlopen(SOURCE).read()
assert hashlib.sha256(data).hexdigest() == SHA256, 'the upstream font changed'
font = TTFont(io.BytesIO(data), recalcTimestamp=False)
options = subset.Options()
options.layout_features = ['*']
options.name_IDs = ['*']
options.name_languages = ['*']
options.notdef_outline = True
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=[cp for cp in font.getBestCmap() if kept(cp)])
subsetter.subset(font)
font['name'].setName('Liberation Sans', 1, 3, 1, 0x0809)
font.save(OUT)
