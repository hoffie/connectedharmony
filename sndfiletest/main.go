package main

import "log"
import "io/ioutil"

import "github.com/hoffie/gosndfile/sndfile"

func main() {
	var ii sndfile.Info
	content, err := ioutil.ReadFile("/tmp/foo.wav")
	if err != nil {
		panic(err)
	}
	fd, err := memfile("foo", content)
	if err != nil {
		panic(err)
	}
	in, err := sndfile.OpenFd(uintptr(fd), sndfile.Read, &ii, true)
	if err != nil {
		panic(err)
	}
	defer in.Close()

	var oi sndfile.Info
	const SF_FORMAT_OPUS = 0x0064
	oi.Format = sndfile.SF_FORMAT_OGG | sndfile.SF_FORMAT_OPUS
	oi.Channels = 2
	oi.Samplerate = 48000
	out, err := sndfile.Open("/tmp/foo.ogg", sndfile.Write, &oi)
	if err != nil {
		panic(err)
	}
	defer out.Close()

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
		w, err := out.WriteItems(buf)
		if err != nil {
			panic(err)
		}
		log.Printf("read %d items, wrote %d items", r, w)
	}
}
