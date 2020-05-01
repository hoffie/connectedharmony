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
	ReferenceURI              string
	//Description string
	WantVideo  bool
	Voices     []Voice
	Recordings []Recording
}

type Recording struct {
	ID              uint64
	ProjectID       uint64
	VoiceID         uint64
	CreatedAt       time.Time
	ParticipantName string `gorm:"size:25"`
	OffsetMsec      int64
	Uploaded        bool
	UserAgent       string `gorm:"size:500"`
	//Integrated bool
	//Reviewed bool
	HasVideo bool
	//AudioWeight uint
}

type Voice struct {
	ID        uint64
	ProjectID uint64 `gorm:"unique_index:idx_projectid_name; not null"`
	Name      string `gorm:"unique_index:idx_projectid_name; not null"`
}
