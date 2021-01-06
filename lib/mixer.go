package lib

import (
	"sync"
	"log"
	"time"
)

const sampleRate = 48000
const tickIntervalMs = 200 // ms
const oneIntervalInSamples = sampleRate * 0.2

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
	ticker := time.NewTicker(tickIntervalMs * time.Millisecond)
	for range ticker.C {
		var pcm [oneIntervalInSamples]int16
		for _, channel := range m.channels {
			channelPCM := channel.PullOneInterval()
			addToMix(&pcm, channelPCM)
		}
		for _, output := range m.outputs {
			output.PushPCM(pcm[:])
		}
	}
}

func addToMix(base *[oneIntervalInSamples]int16, add [oneIntervalInSamples]int16) {
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
	if len(mc.buffer) > oneIntervalInSamples*5 {
		log.Printf("FIXME buffer getting too large")
	}
}

func (mc *MixerChannel) PullOneInterval() [oneIntervalInSamples]int16 {
	mc.bufferMtx.Lock()
	defer mc.bufferMtx.Unlock()
	var ret [oneIntervalInSamples]int16
	copy(ret[:], mc.buffer)
	if len(mc.buffer) < oneIntervalInSamples {
		print("FIXME buffer underflow")
		//FIXME count metric
		//FIXME track number of missing samples and discard them once arriving
		return ret
	}
	mc.buffer = mc.buffer[oneIntervalInSamples:]
	return ret
}
