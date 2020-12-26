package lib

import (
	"io"
	"io/ioutil"
	"sync"
	"errors"
	"time"
	"log"

	"github.com/hoffie/gosndfile/sndfile"
)

type PCMRecorder struct {
	Output io.Writer
}

func (rr *PCMRecorder) PushPCM(pcm []int16) {
	for _, sample := range pcm {
		b := sampleToBytes(sample)
		rr.Output.Write(b)
	}
}

func sampleToBytes(i int16) []byte {
	b := make([]byte, 2)
	b[0] = byte(i & 0xff)
	b[1] = byte(i >> 8)
	return b
}

func samplesToBytes(s []int16) []byte {
	r := make([]byte, len(s)*2)
	for i, t := range s {
		b := sampleToBytes(t)
		r[i*2] = b[0]
		r[i*2+1] = b[1]
	}
	return r
}

type OpusChunkRecorder struct {
	buffer                 []int16
	bufferMtx              sync.Mutex
	currentChunkIdx        uint64
	chunks                 map[uint64][]byte
	pcm                    []int16
}

func NewOpusChunkRecorder() *OpusChunkRecorder {
	ocr := &OpusChunkRecorder{
		chunks: make(map[uint64][]byte),
	}
	return ocr
}

func (ocr *OpusChunkRecorder) PushPCM(pcm []int16) {
	ocr.pcm = append(ocr.pcm, pcm...)
	ocr.encode()
}

func (ocr *OpusChunkRecorder) encode() {
	const chunkSize = sampleRate / 5 // 0.2s
	ocr.bufferMtx.Lock()
	defer ocr.bufferMtx.Unlock()
	var pcmChunk []int16
	for len(ocr.pcm) >= chunkSize {
		pcmChunk = ocr.pcm[:chunkSize]
		ocr.pcm = ocr.pcm[chunkSize:]
		ocr.handleChunk(pcmChunk)
	}
}

func (ocr *OpusChunkRecorder) handleChunk(pcmChunk []int16) {
	// may only be called from encode() which holds the buffer lock
	const keepChunks = 1000
	log.Printf("finishing chunk %d", ocr.currentChunkIdx)
	ocr.chunks[ocr.currentChunkIdx] = pcmToOggOpus(pcmChunk)
	ocr.currentChunkIdx++
	if ocr.currentChunkIdx >= keepChunks {
		log.Printf("deleting old chunk %d", ocr.currentChunkIdx-keepChunks)
		delete(ocr.chunks, ocr.currentChunkIdx-keepChunks)
	}
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

func pcmToOggOpus(pcm []int16) []byte {
	var ii sndfile.Info
	ii.Format = sndfile.SF_FORMAT_RAW | sndfile.SF_FORMAT_PCM_16
	ii.Channels = 1
	ii.Samplerate = sampleRate
	fd, err := memfile("source", samplesToBytes(pcm))
	if err != nil {
		panic(err)
	}
	in, err := sndfile.OpenFd(uintptr(fd), sndfile.Read, &ii, true)
	if err != nil {
		panic(err)
	}
	defer in.Close()

	var oi sndfile.Info
	oi.Format = sndfile.SF_FORMAT_OGG | sndfile.SF_FORMAT_OPUS
	oi.Channels = 1
	oi.Samplerate = sampleRate
	out, err := sndfile.Open("/tmp/foo.ogg", sndfile.Write, &oi)
	if err != nil {
		panic(err)
	}

	buf := make([]int32, 1024)
	for {
		r, err := in.ReadItems(buf)
		if err != nil {
			panic(err)
		}
		if r == 0 {
			break
		}
		buf = buf[:r]
		_, err = out.WriteItems(buf)
		if err != nil {
			panic(err)
		}
	}
	out.Close() // must be done before reading the output again
	c, err := ioutil.ReadFile("/tmp/foo.ogg")
	if err != nil {
		panic(err)
	}
	return c
}
