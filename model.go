package main

import (
	"time"
)

type Project struct {
	ID                        uint64
	Key                       string
	Ensemble                  string
	Title                     string
	CreatedAt                 time.Time
	MetronomeBeatsBeforeStart uint
	MetronomeBeatsPerMeasure  uint
	MetronomeBeatsPerMinute   uint
	MetronomeBeepFrequency    float64
	ScoreURI                  string
	//Description string
	WantVideo        bool
	ReferenceIsVideo bool
	Voices           []Voice
	Recordings       []Recording
}

type Recording struct {
	ID                 uint64
	Token              string `gorm:"size:40"`
	ProjectID          uint64
	VoiceID            uint64
	Voice              Voice
	CreatedAt          time.Time
	ParticipantName    string `gorm:"size:25"`
	ParticipantComment string `gorm:"size:1024"`
	OffsetMsec         int64
	Uploaded           bool
	UserAgent          string `gorm:"size:512"`
	HasVideo           bool
	NumAttempts        int
	NumErrors          int
}

type Voice struct {
	ID        uint64
	ProjectID uint64 `gorm:"unique_index:idx_projectid_name; not null"`
	Name      string `gorm:"unique_index:idx_projectid_name; not null"`
}

type ErrorEvent struct {
	ID            uint64
	CreatedAt     time.Time
	IP            string
	UserAgent     string `gorm:"size:512"`
	ClientErrorID uint64
	Source        string
	Message       string `gorm:"size:1024"`
	URI           string
	Line          int64
	Column        int64
	ErrorObject   string `gorm:"size:8192"`
}
