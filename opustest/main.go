package main

import "os"
import "io"
import "github.com/hraban/opus"


func main() {
	fname1 := "/tmp/foo.opus"
	f1, err := os.Open(fname1)
	if err != nil {
		panic("failed to open")
	}
	s1, err := opus.NewStream(f1)
	if err != nil {
		panic("failed to create stream")
	}
	defer s1.Close()
	channels := 2
	pcmbuf1 := make([]int16, 16384)
	allPcm := make([]int16, 0)
	o, err := os.Create("/tmp/foo.s16le")
	defer o.Close()
	if err != nil {
		panic(err)
	}
	for {
		n1, err := s1.Read(pcmbuf1)
		if err == io.EOF {
			break
		} else if err != nil {
			panic("error during read")
		}
		pcm1 := pcmbuf1[:n1*channels]
		allPcm = append(allPcm, pcm1...)
	}
	sampleLimit := 48000*5 * channels
	delayOffsetSamples := 2 * 48000 * channels
	for idx, sample := range allPcm {
		if idx >= sampleLimit {
			break
		}
		if idx > delayOffsetSamples {
			sample += allPcm[idx-delayOffsetSamples]
		}
		b := make([]byte, 2)
		b[0] = byte(sample & 0xff)
		b[1] = byte(sample >> 8)
		o.Write(b)
	}
}
