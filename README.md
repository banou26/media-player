## Media Player

A player that somehow manages to playback MKV files

# Things to fix
- Everytime a new text starts being rendered by libass-wasm (JavascriptSubtitlesOctopus), we might drop a few video frames?
- might wanna use https://www.radix-ui.com/
- PRETTY IMPORTANT The player randomly stops working completly after a normal seek, no errors thrown, just happens after a seek, check it out
- a test video has subtitles that switch from time to time, subtitle index is kept but array items change indexes
