package media

import (
	"io"
	"log"
	"sync"

	"github.com/notedit/gst"
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
	pcmMtx sync.Mutex
	stream Streamer
	pcm    []int16
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
	ocs.pcmMtx.Lock()
	defer ocs.pcmMtx.Unlock()
	var pcmChunk []int16
	for len(ocs.pcm) >= oneIntervalInSamples {
		pcmChunk = ocs.pcm[:oneIntervalInSamples]
		ocs.pcm = ocs.pcm[oneIntervalInSamples:]
		ocs.handleChunk(pcmChunk)
	}
}

func (ocs *OpusChunkStreamer) handleChunk(pcmChunk []int16) {
	// may only be called from encode() which holds the pcmMtx
	chunk, err := encodePCMChunk(pcmChunk)
	if err != nil {
		log.Printf("failed to encode to opus: %v", err)
		return
	}
	err = ocs.stream.WriteBinary(chunk)
	if err != nil {
		log.Printf("cannot write to streamer: %v", err)
		return
	}
}

func encodePCMChunk(pcm []int16) ([]byte, error) {
	pipeline, err := gst.ParseLaunch("appsrc name=appsrc is-live=false do-timestamp=false block=true ! rawaudioparse format=pcm pcm-format=s16le num-channels=1 sample-rate=48000 use-sink-caps=false ! audioconvert ! queue ! opusenc bitrate=128000 bitrate-type=constrained-vbr ! webmmux ! queue ! appsink name=appsink sync=false")
	if err != nil {
		return nil, err
	}

	pipeline.SetState(gst.StatePlaying)
	defer pipeline.SetState(gst.StateNull)

	go func() {
		appsrc := pipeline.GetByName("appsrc")
		pcmBytes := samplesToBytes(pcm)
		err := appsrc.PushBuffer(pcmBytes)
		if err != nil {
			panic(err)
		}
		appsrc.EndOfStream()
	}()

	appsink := pipeline.GetByName("appsink")
	encoded := []byte{}
	for {
		sample, err := appsink.PullSample()
		if err != nil {
			if appsink.IsEOS() {
				break
			}
			log.Printf("error during reading from appsink: %v", err)
			break
		}
		encoded = append(encoded, sample.Data...)
	}

	return encoded, nil
}
