#!/bin/bash

INPUTS=""
INPUT_COUNT=0
OUTPUT_INTERMEDIATE=static/mixed.wav
OUTPUT=static/mixed.webm
THREADS=8

for input in recordings/*.webm; do
		INPUTS="${INPUTS} -i file:$input"
		INPUT_COUNT=$(($INPUT_COUNT+1))
done

ffmpeg -threads ${THREADS} $INPUTS -y -filter_complex "loudnorm=i=-20, amix=inputs=${INPUT_COUNT}:duration=longest:dropout_transition=3" -r:a 48 ${OUTPUT_INTERMEDIATE}
duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${OUTPUT_INTERMEDIATE})
# Drop first and last second of silence as it typically contains clicks
duration=$(python -c "print($duration - 1)")
ffmpeg -threads ${THREADS} -y -i ${OUTPUT_INTERMEDIATE} -r:a 48 -b:a 128k -ss 1 -t ${duration} -filter_complex "ladspa=file=cmt:freeverb3:controls=c1=0.8|c2=0.25|c3=0.3|c4=0.8|c5=0.5, loudnorm=i=-15" -r:a 48 -b:a 128k -ac 2 ${OUTPUT}
