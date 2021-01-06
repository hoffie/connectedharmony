package lib

import (
	"io"
	"io/ioutil"
	"log"
	"os"
	"sync"

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

type OpusChunkStreamer struct {
	buffer    []int16
	bufferMtx sync.Mutex
	stream    Streamer
	pcm       []int16
}

type Streamer interface {
	WriteBinary(msg []byte) error
}

func NewOpusChunkStreamer(stream Streamer) *OpusChunkStreamer {
	ocs := &OpusChunkStreamer{
		stream: stream,
	}
	return ocs
}

func (ocs *OpusChunkStreamer) PushPCM(pcm []int16) {
	ocs.pcm = append(ocs.pcm, pcm...)
	ocs.encode()
}

func (ocs *OpusChunkStreamer) encode() {
	ocs.bufferMtx.Lock()
	defer ocs.bufferMtx.Unlock()
	var pcmChunk []int16
	for len(ocs.pcm) >= oneIntervalInSamples {
		pcmChunk = ocs.pcm[:oneIntervalInSamples]
		ocs.pcm = ocs.pcm[oneIntervalInSamples:]
		ocs.handleChunk(pcmChunk)
	}
}

func (ocs *OpusChunkStreamer) handleChunk(pcmChunk []int16) {
	// may only be called from encode() which holds the buffer lock
	chunk := pcmToOggOpus(pcmChunk)
	err := ocs.stream.WriteBinary(chunk)
	if err != nil {
		log.Printf("err=%v", err)
		log.Printf("FIXME cannot write to stream")
	}
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
	outputMemfd, err := memfile("target", []byte{})
	if err != nil {
		panic(err)
	}
	out, err := sndfile.OpenFd(uintptr(outputMemfd), sndfile.Write, &oi, false /* we close outpoutMemfd ourselves */)
	// will be closed explicitly below
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
	f := os.NewFile(uintptr(outputMemfd), "outputMemFd")
	defer f.Close()
	_, err = f.Seek(0, os.SEEK_SET)
	if err != nil {
		panic("could not seek memfd")
	}
	c, err := ioutil.ReadAll(f)
	if err != nil {
		panic(err)
	}
	return c
}
