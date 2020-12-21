package main

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/jinzhu/gorm"
)

func sanitizePathname(s string, length int) string {
	s = badPathCharsRegexp.ReplaceAllString(s, "-")
	if len(s) > length {
		s = s[:length]
	}
	s = strings.Trim(s, "-")
	return s
}

func generateToken() string {
	n := 30
	b := make([]byte, n)
	_, err := rand.Read(b)
	if err != nil {
		panic("failed to read random bytes")
	}
	return base64.URLEncoding.EncodeToString(b)
}

var (
	audioTypes = []struct {
		extension string
		mime      string
	}{
		{".webm", "audio/webm"},
		{".mp4", "audio/mp4"},
		{".mp3", "audio/mpeg"},
	}
	videoTypes = []struct {
		extension string
		mime      string
	}{
		{".webm", "video/webm"},
		{".mp4", "video/mp4"},
	}
	badPathCharsRegexp = regexp.MustCompile(`[^a-zA-Z0-9]+`)
)

func saveRecordingMetadata(c *gin.Context) {
	var m struct {
		VoiceID            uint64 `binding:"required"`
		ParticipantName    string
		ParticipantComment string
		OffsetMsec         int64
		HasVideo           bool
		NumAttempts        int
		NumErrors          int
	}
	if err := c.BindJSON(&m); err != nil {
		c.JSON(400, gin.H{"error": "bad metadata"})
		return
	}
	var p Project
	err := db.First(&p, "key = ?", c.Param("projectKey")).Error
	if err == gorm.ErrRecordNotFound {
		c.JSON(400, gin.H{"error": "invalid project"})
		return
	}
	if err != nil {
		log.Printf("failed to lookup project: %v", err)
		c.AbortWithStatus(500)
		return
	}

	var v Voice
	err = db.First(&v, "project_id = ? AND id = ?", p.ID, m.VoiceID).Error
	if err == gorm.ErrRecordNotFound {
		c.JSON(400, gin.H{"error": "invalid voice"})
		return
	}
	if err != nil {
		log.Printf("failed to lookup voice: %v", err)
		c.AbortWithStatus(500)
		return
	}

	r := Recording{
		ProjectID:          p.ID,
		Token:              generateToken(),
		VoiceID:            v.ID,
		ParticipantName:    strings.TrimSpace(m.ParticipantName),
		ParticipantComment: strings.TrimSpace(m.ParticipantComment),
		OffsetMsec:         m.OffsetMsec,
		HasVideo:           m.HasVideo,
		UserAgent:          c.GetHeader("User-Agent"),
		NumAttempts:        m.NumAttempts,
		NumErrors:          m.NumErrors,
	}
	err = db.Save(&r).Error
	if err != nil {
		log.Printf("failed to save recording metadata: %v", err)
		c.AbortWithStatus(500)
		return
	}
	c.JSON(201, gin.H{
		"success":        true,
		"RecordingToken": r.Token,
	})
}

func saveRecordingFile(c *gin.Context) {
	var r Recording
	q := db.Table("recordings")
	q = q.Preload("Voice")
	q = q.Joins("LEFT JOIN projects ON projects.id = recordings.project_id")
	q = q.Where("projects.key = ?", c.Param("projectKey"))
	q = q.Where("recordings.token = ?", c.Param("recordingToken"))
	q = q.First(&r)
	err := q.Error
	if err == gorm.ErrRecordNotFound {
		c.JSON(404, gin.H{"error": "project/recording not found"})
		return
	}
	if err != nil {
		log.Printf("failed to retrieve recording/project")
		c.AbortWithStatus(500)
		return
	}
	dir := filepath.Join(dataPath, c.Param("projectKey"))
	err = os.MkdirAll(dir, 0o700)
	if err != nil {
		log.Printf("failed to create directories")
		c.AbortWithStatus(500)
		return
	}
	date := time.Now().Local().Format("20060102")
	name := fmt.Sprintf("%s_%s_%s_%d", sanitizePathname(r.Voice.Name, 25), sanitizePathname(r.ParticipantName, 25), date, r.ID)
	w, err := os.Create(filepath.Join(dir, name+".media"))
	if err != nil {
		log.Printf("failed to open output file")
		c.AbortWithStatus(500)
		return
	}
	defer w.Close()

	_, err = io.Copy(w, c.Request.Body)
	if err != nil {
		log.Printf("failed to stream request body into output file")
		c.AbortWithStatus(500)
		return
	}

	r.Uploaded = true
	err = db.Save(&r).Error
	if err != nil {
		log.Printf("failed to save updated recording entry")
		c.AbortWithStatus(500)
		return
	}
	c.JSON(200, gin.H{"success": true})
}

type jsonProject struct {
	Ensemble          string
	Title             string
	ScoreURI          string
	BeatsPerMeasure   uint
	BeatsPerMinute    uint
	BeatsBeforeStart  uint
	BeepFrequency     float64
	Voices            []jsonVoice
	NamedParticipants []jsonParticipant
	NumParticipants   int
	WantVideo         bool
	ReferenceIsVideo  bool
}

type jsonVoice struct {
	ID             uint64
	Name           string
	ReferenceMedia []jsonReferenceMedia
}

type jsonParticipant struct {
	Name string
}

type jsonReferenceMedia struct {
	Path string
	Type string
}

func getProject(c *gin.Context) {
	var p Project
	q := db.Preload("Voices", func(db *gorm.DB) *gorm.DB {
		return db.Order("voices.id")
	})
	q = q.Preload("Recordings", func(db *gorm.DB) *gorm.DB {
		return db.Order("recordings.created_at DESC")
	})
	q = q.First(&p, "key = ?", c.Param("projectKey"))
	err := q.Error
	if err == gorm.ErrRecordNotFound {
		c.JSON(404, gin.H{"error": "invalid project"})
		return
	}
	if err != nil {
		log.Printf("failed to lookup project: %v", err)
		c.AbortWithStatus(500)
		return
	}

	jp := jsonProject{
		Ensemble:          p.Ensemble,
		Title:             p.Title,
		ScoreURI:          p.ScoreURI,
		BeatsPerMeasure:   p.MetronomeBeatsPerMeasure,
		BeatsPerMinute:    p.MetronomeBeatsPerMinute,
		BeatsBeforeStart:  p.MetronomeBeatsBeforeStart,
		BeepFrequency:     p.MetronomeBeepFrequency,
		Voices:            make([]jsonVoice, len(p.Voices)),
		NamedParticipants: make([]jsonParticipant, 0),
		NumParticipants:   len(p.Recordings),
		WantVideo:         p.WantVideo,
		ReferenceIsVideo:  p.ReferenceIsVideo,
	}
	for i, v := range p.Voices {
		references := make([]jsonReferenceMedia, 0)
		base := filepath.Join(p.Key, strconv.Itoa(int(v.ID)))
		types := audioTypes
		if p.ReferenceIsVideo {
			types = videoTypes
		}
		for _, mediaVariant := range types {
			path := base + mediaVariant.extension
			diskPath := filepath.Join(staticPath, path)
			s, err := os.Stat(diskPath)
			if err != nil || s.IsDir() {
				log.Printf("missing reference media at diskPath=%s for Project.Key=%s and Voice.ID=%d", diskPath, p.Key, v.ID)
				continue
			}
			references = append(references, jsonReferenceMedia{
				Path: path,
				Type: mediaVariant.mime,
			})
		}
		jp.Voices[i] = jsonVoice{
			ID:             v.ID,
			Name:           v.Name,
			ReferenceMedia: references,
		}
	}
	nameDedup := make(map[string]bool, 0)
	for _, r := range p.Recordings {
		if r.ParticipantName == "" {
			continue
		}
		key := fmt.Sprintf("%d-%s", r.VoiceID, r.ParticipantName)
		if _, ok := nameDedup[key]; ok {
			continue
		}
		jp.NamedParticipants = append(jp.NamedParticipants, jsonParticipant{Name: r.ParticipantName})
		nameDedup[key] = true
	}
	c.JSON(200, jp)
}

func saveErrorEvent(c *gin.Context) {
	var jsonEvent struct {
		ClientErrorID uint64
		Source        string
		Message       string
		URI           string
		Line          int64
		Column        int64
		ErrorObject   string
	}
	if err := c.BindJSON(&jsonEvent); err != nil {
		log.Printf("saveErrorEvent BindJSON error: %s", err)
		c.JSON(400, gin.H{"error": "bad event data"})
		return
	}

	e := ErrorEvent{
		IP:            c.ClientIP(),
		UserAgent:     c.GetHeader("User-Agent"),
		ClientErrorID: jsonEvent.ClientErrorID,
		Source:        jsonEvent.Source,
		Message:       jsonEvent.Message,
		URI:           jsonEvent.URI,
		Line:          jsonEvent.Line,
		Column:        jsonEvent.Column,
		ErrorObject:   jsonEvent.ErrorObject,
	}
	err := db.Save(&e).Error
	if err != nil {
		log.Printf("failed to error event: %v", err)
		c.AbortWithStatus(500)
		return
	}
	c.JSON(201, gin.H{
		"success":      true,
		"ErrorEventID": e.ID,
	})
}
