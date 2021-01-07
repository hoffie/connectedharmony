package media

import (
	"log"
	"sync"
	"time"
)

const sampleRate = 48000
const tickIntervalMs = 1000 // ms
const oneIntervalInSamples = sampleRate * tickIntervalMs / 1000

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
	Name           string
	delaySamples   int
	buffer         []int16 // ring buffer, 3 seconds?
	bufferMtx      sync.Mutex
	discardSamples int
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
	log.Printf("MixerChannel.PushPCM: got %d samples", len(pcm))
	// Appends the given PCM data to the client with the given name
	mc.bufferMtx.Lock()
	defer mc.bufferMtx.Unlock()
	mc.buffer = append(mc.buffer, pcm...)
	if mc.discardSamples > 0 {
		// have we already returned silence due to missing data?
		// then we have to discard the fresh data partially here
		// in order to avoid getting out of sync.
		if mc.discardSamples < len(mc.buffer) {
			// we got enough new data, discard just as much as necessary
			mc.buffer = mc.buffer[mc.discardSamples:]
			mc.discardSamples = 0
		} else {
			// we still have too little data. discard everything. :(
			mc.discardSamples -= len(mc.buffer)
			mc.buffer = []int16{}
		}
	}
	if len(mc.buffer) > oneIntervalInSamples*5 {
		log.Printf("MixerChannel.PushPCM: buffer too large (%d samples)", len(mc.buffer))
	}
}

func (mc *MixerChannel) PullOneInterval() [oneIntervalInSamples]int16 {
	mc.bufferMtx.Lock()
	defer mc.bufferMtx.Unlock()
	var ret [oneIntervalInSamples]int16
	copy(ret[:], mc.buffer)
	if len(mc.buffer) < oneIntervalInSamples {
		log.Printf("MixerChannel.PullOneInterval: buffer underflow, returning silence")
		//FIXME count metric
		mc.discardSamples += oneIntervalInSamples - len(mc.buffer)
		return ret
	}
	mc.buffer = mc.buffer[oneIntervalInSamples:]
	return ret
}
