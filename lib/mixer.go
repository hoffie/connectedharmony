package lib

import (
	"sync"
	"log"
	"time"
)

const sampleRate = 48000
const oneSecondInSamples = sampleRate * 1

type AudioSink interface {
	PushPCM(pcm []int16)
}

type Mixer struct {
	channels map[string]*MixerChannel
	outputs  []AudioSink
}

func NewMixer() *Mixer {
	return &Mixer{
		channels: make(map[string]*MixerChannel),
	}
}

type MixerChannel struct {
	Name         string
	delaySamples int
	buffer       []int16 // ring buffer, 3 seconds?
	bufferMtx    sync.Mutex
}

func (m *Mixer) GetChannel(name string) *MixerChannel {
	// FIXME error check
	if _, ok := m.channels[name]; !ok {
		m.AddChannel(name)
	}
	return m.channels[name]
}

func (m *Mixer) AddChannel(name string) {
	m.channels[name] = &MixerChannel{
		Name: name,
	}
}

func (m *Mixer) AddOutput(o AudioSink) {
	m.outputs = append(m.outputs, o)
}

func (m *Mixer) Produce() {
	ticker := time.NewTicker(1 * time.Second)
	for range ticker.C {
		var pcm [oneSecondInSamples]int16
		for _, channel := range m.channels {
			channelPCM := channel.PullOneSecond()
			addToMix(&pcm, channelPCM)
		}
		for _, output := range m.outputs {
			output.PushPCM(pcm[:])
		}
	}
}

func addToMix(base *[oneSecondInSamples]int16, add [oneSecondInSamples]int16) {
	if len(base) != len(add) {
		panic("can only mix same-length data")
	}
	for i, v := range base {
		base[i] = v + add[i]
	}
}

func (mc *MixerChannel) PushPCM(pcm []int16) {
	// Appends the given PCM data to the client with the given name
	mc.bufferMtx.Lock()
	defer mc.bufferMtx.Unlock()
	mc.buffer = append(mc.buffer, pcm...)
	if len(mc.buffer) > oneSecondInSamples*3 {
		log.Printf("FIXME buffer getting too large")
	}
}

func (mc *MixerChannel) PullOneSecond() [oneSecondInSamples]int16 {
	mc.bufferMtx.Lock()
	defer mc.bufferMtx.Unlock()
	var ret [oneSecondInSamples]int16
	copy(ret[:], mc.buffer)
	if len(mc.buffer) < oneSecondInSamples {
		print("FIXME buffer underflow")
		return ret
	}
	mc.buffer = mc.buffer[oneSecondInSamples:]
	return ret
}
