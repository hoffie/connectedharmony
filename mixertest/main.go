package main

import "github.com/hoffie/connectedharmony/lib"

func main() {
	m := lib.NewMixer()
	m.AddChannel("one")
	m.AddChannel("two")
	r := RawRecorder{}
	m.AddOutput(r)
	m.Produce()
}
