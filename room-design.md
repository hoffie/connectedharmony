Design
======
Virtual pseudo-synchronuous audio room

Features
========
- chat:
  - free text
  - reactions: thumbs up/down, smile, raise hands, clap
  - aggregate: emotions -- "13 raised hands"?

- regularly updated small profile pictures
- instrument/voice indicator
- full video support?
- modes:
  - Flow (Row 0 -> Row 1 -> ...)
  - Solo (everyone muted except soloist, soloist should not hear themself)
- dynamic row change
- listener "read only" mode (last row enforced?)
- latency callibration (record claps, auto-calculate or let user align waveforms?)
- auto reconnect
- recording
- mix panel
  - delay correction
  - left/right panning
  - volume per row
  - group by voice (for volume adjustments)
- reverb
- resampling for rates other 48khz -> client-side?
- support for non-opus (aac?) -> client-side?
- score sharing
- hear-same-row mode

Views
=====
- Join
- Room

# Naming
Pulse
Flow
Rooms
Adaptive
Perceived Live
Serial
Perceived
Live Perception
Foundation
Layered

TODO
====

Logic
=====
Row 0 Client: t0
Row 0 Server: t0+1s
Row 1 Client: t0+2s?
Row 1 Server: t0+3s
