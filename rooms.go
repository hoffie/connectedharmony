package main

import (
	"errors"
	"sync"

	"github.com/hoffie/connectedharmony/pkg/media"
)

type Rooms struct {
	rooms map[string]*Room
	mtx   *sync.Mutex
}

func NewRooms() *Rooms {
	return &Rooms{
		rooms: make(map[string]*Room),
		mtx:   &sync.Mutex{},
	}
}

func (r *Rooms) Get(name string) *Room {
	r.mtx.Lock()
	defer r.mtx.Unlock()
	_, ok := r.rooms[name]
	if !ok {
		mixer := media.NewMixer()
		go mixer.Produce()
		r.rooms[name] = &Room{
			Name:  name,
			Mixer: mixer,
			users: make(map[string]*User),
			mtx:   &sync.Mutex{},
		}
	}
	return r.rooms[name]
}

type Room struct {
	Name  string
	users map[string]*User
	Mixer *media.Mixer
	mtx   *sync.Mutex
}

type User struct {
	Name        string
	DecodeToPCM *media.DecodeToPCM
}

func (r *Room) AddUser(name string) error {
	r.mtx.Lock()
	defer r.mtx.Unlock()
	_, ok := r.users[name]
	if ok {
		return errors.New("user already exists")
	}
	mixerChannel := r.Mixer.GetChannel(name)
	r.users[name] = &User{
		Name:        name,
		DecodeToPCM: media.NewDecodeToPCM(mixerChannel),
	}
	return nil
}

func (r *Room) GetUser(name string) (*User, error) {
	r.mtx.Lock()
	defer r.mtx.Unlock()
	_, ok := r.users[name]
	if !ok {
		return nil, errors.New("no such user")
	}
	return r.users[name], nil
}
