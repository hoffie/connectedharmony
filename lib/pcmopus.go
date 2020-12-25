package lib

import (
	"io"
	"io/ioutil"
	"bytes"
	"log"

	"github.com/hraban/opus"
)

var opusStream *opus.Stream
var opusBuffer = &wrappedByteBuffer{
	buffer: &bytes.Buffer{},
}

type wrappedByteBuffer struct {
	// Basically emulates a bytes.Buffer but ensures
	// that the buffer is accessed by reference.
	// This works around a problem in the opus library C/Go interaction
	// which should probably fixed on the go-opus side.
	// TODO: raise ticket
	buffer *bytes.Buffer
}

func (wbb *wrappedByteBuffer) Read(data []byte) (int, error) {
	return wbb.buffer.Read(data)
}

func (wbb *wrappedByteBuffer) Write(data []byte) (int, error) {
	return wbb.buffer.Write(data)
}

func (wbb *wrappedByteBuffer) Len() (int) {
	return wbb.buffer.Len()
}

func initOpusStream() error {
	if opusStream != nil {
		return nil
	}
	const channels = 1
	var err error
	//FIXME per user
	opusStream, err = opus.NewStream(opusBuffer)
	return err
}

func PcmFromOpusReader(o io.Reader) ([]int16, error) {
	// FIXME global but should be per user
	var frameSizeMs float32 = 60 // max
	const channels = 1
	frameSize := channels * frameSizeMs * sampleRate / 1000
	opusBytes, err := ioutil.ReadAll(o)
	if err != nil {
		return nil, err
	}

	_, err = opusBuffer.Write(opusBytes)
	if err != nil {
		return nil, err
	}
	for opusBuffer.Len() < 2048 {
		return []int16{}, nil
	}
	err = initOpusStream()
	if err != nil {
		return nil, err
	}
	var allPCM []int16
	pcm := make([]int16, int(frameSize))
	for opusBuffer.Len() > 1 {
		n, err := opusStream.Read(pcm)
		if err != nil {
			log.Printf("opus decoder saw %v", err)
			return nil, err
		}
		pcm = pcm[:n*channels]
		allPCM = append(allPCM, pcm...)
	}
	return allPCM, nil
}
