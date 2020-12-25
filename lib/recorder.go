package lib

import (
	"io"
	"sync"
	"errors"
	"time"
	"log"

	"github.com/hraban/opus"
)

type PCMRecorder struct {
	Output io.Writer
}

func (rr *PCMRecorder) PushPCM(pcm []int16) {
	for _, sample := range pcm {
		b := make([]byte, 2)
		b[0] = byte(sample & 0xff)
		b[1] = byte(sample >> 8)
		rr.Output.Write(b)
	}
}

type OpusChunkRecorder struct {
	buffer                 []int16
	bufferMtx              sync.Mutex
	currentChunkIdx        uint64
	chunks                 map[uint64][]byte
	currentChunk           []byte
	currentChunkFrameCount int
	enc                    *opus.Encoder
	pcm                    []int16
}

func NewOpusChunkRecorder() *OpusChunkRecorder {
	ocr := &OpusChunkRecorder{
		chunks: make(map[uint64][]byte),
	}
	ocr.newEncoder()
	return ocr
}

func (ocr *OpusChunkRecorder) newEncoder() {
	// Is called before first use and when creating a fresh chunk
	const channels = 1 // mono; 2 for stereo

	enc, err := opus.NewEncoder(sampleRate, channels, opus.AppAudio)
	if err != nil {
		panic("opus encoder creation failed")
	}
	const opusBitrate = 128000
	err = enc.SetBitrate(opusBitrate)
	if err != nil {
		panic("failed to set opus bitrate")
	}
	ocr.enc = enc
}

func (ocr *OpusChunkRecorder) PushPCM(pcm []int16) {
	ocr.pcm = append(ocr.pcm, pcm...)
	ocr.encode()
}

func (ocr *OpusChunkRecorder) encode() {
	const bufferSize = 1000 // choose any buffer size you like. 1k is plenty.
	const frameSize = 40    // valid: 2.5, 5, 10, 20, 40, 60
	const samplesPerFrame = sampleRate / 1000 * frameSize
	ocr.bufferMtx.Lock()
	defer ocr.bufferMtx.Unlock()
	for len(ocr.pcm) > samplesPerFrame {
		frame := ocr.pcm[0:samplesPerFrame]
		ocr.pcm = ocr.pcm[samplesPerFrame:]
		data := make([]byte, bufferSize)
		n, err := ocr.enc.Encode(frame, data)
		if err != nil {
			panic("opus encoding failed")
		}
		data = data[:n]
		ocr.handleFrame(data)
	}
}

func (ocr *OpusChunkRecorder) handleFrame(data []byte) {
	// may only be called from encode() which holds the buffer lock
	const keepChunks = 1000
	const framesPerChunk = 25 // * frameSize=40ms -> 1s chunks
	ocr.currentChunk = append(ocr.currentChunk, data...)
	ocr.currentChunkFrameCount++
	if ocr.currentChunkFrameCount < framesPerChunk {
		return
	}
	log.Printf("finishing chunk %d", ocr.currentChunkIdx)
	ocr.chunks[ocr.currentChunkIdx] = ocr.currentChunk
	ocr.currentChunkIdx++
	ocr.currentChunkFrameCount = 0
	ocr.currentChunk = []byte{}
	if ocr.currentChunkIdx >= keepChunks {
		log.Printf("deleting old chunk %d", ocr.currentChunkIdx-keepChunks)
		delete(ocr.chunks, ocr.currentChunkIdx-keepChunks)
	}
	ocr.newEncoder()
}

func (ocr *OpusChunkRecorder) GetChunk(idx uint64) ([]byte, error) {
	ok := false
	var c []byte
	for !ok {
		c, ok = ocr.chunks[idx]
		if !ok {
			if idx < ocr.currentChunkIdx {
				return []byte{}, errors.New("no such chunk")
			}
			// FIXME: use channel which unblocks on handleFrame()
			time.Sleep(100 * time.Millisecond)
		}
	}
	return c, nil
}
