package media

import (
	"encoding/binary"
	"log"
	"sync"

	"github.com/notedit/gst"
)

func bytesToInt16(bs []byte) []int16 {
	is := make([]int16, len(bs)/2)
	for x := 0; x < len(bs)/2; x += 2 {
		is[x] = int16(binary.LittleEndian.Uint16([]byte{bs[x*2], bs[x*2+1]}))
	}
	return is
}

type DecodeToPCM struct {
	target   AudioSink
	pipeline *gst.Pipeline
	appsrc   *gst.Element
	appsink  *gst.Element
	mtx      *sync.Mutex
}

func NewDecodeToPCM(target AudioSink) *DecodeToPCM {
	pipeline, err := gst.ParseLaunch("appsrc name=appsrc format=time is-live=true do-timestamp=true max-bytes=16384 block=true ! decodebin3 ! audioconvert ! audioresample ! audio/x-raw,format=S16LE,channels=1,rate=48000 ! appsink name=appsink")
	if err != nil {
		panic(err)
	}

	pipeline.SetState(gst.StatePlaying)

	appsrc := pipeline.GetByName("appsrc")
	appsink := pipeline.GetByName("appsink")

	go func() {
		for {
			sample, err := appsink.PullSample()
			if err != nil {
				if appsink.IsEOS() {
					log.Printf("done")
					return
				}
				panic(err)
			}
			target.PushPCM(bytesToInt16(sample.Data))
		}
	}()

	return &DecodeToPCM{
		target:   target,
		pipeline: pipeline,
		appsrc:   appsrc,
		appsink:  appsink,
	}
}

func (dtp *DecodeToPCM) Stop() {
	dtp.appsrc.SendEvent(gst.NewEosEvent())
	dtp.pipeline.SetState(gst.StateNull)
}

func (dtp *DecodeToPCM) PushEncoded(b []byte) error {
	if len(b) == 0 {
		// pushing nothing is no error, but would crash gst:
		return nil
	}
	return dtp.appsrc.PushBuffer(b)
}
