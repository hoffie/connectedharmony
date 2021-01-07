package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/hoffie/connectedharmony/pkg/media"

	"github.com/gin-gonic/gin"
	"gopkg.in/olahol/melody.v1"

	"github.com/jinzhu/gorm"
	_ "github.com/jinzhu/gorm/dialects/sqlite"

	"github.com/gin-contrib/pprof"
)

var router *gin.Engine
var db *gorm.DB

var dbPath string
var staticPath string
var uiPath string
var dataPath string
var listen string
var debug bool

var rooms *Rooms

func init() {
	flag.StringVar(&staticPath, "staticPath", "./static", "path to the directory containing static files")
	flag.StringVar(&uiPath, "uiPath", "./ui", "path to the directory containing ui files")
	flag.StringVar(&dataPath, "dataPath", "./data", "path to the directory where recordings will be placed")
	flag.StringVar(&listen, "listen", "127.0.0.1:3000", "host:port to listen on")
	flag.BoolVar(&debug, "debug", false, "whether to enable debugging features")
	if err := os.MkdirAll(dataPath, 0o700); err != nil {
		log.Printf("failed to create data dir: %v", err)
	}
}

func main() {
	flag.Parse()
	dbPath = filepath.Join(dataPath, "db.sqlite")

	if !debug {
		gin.SetMode(gin.ReleaseMode)
	}

	var err error
	db, err = gorm.Open("sqlite3", dbPath)
	if err != nil {
		panic("failed to connect database")
	}
	defer db.Close()
	db.AutoMigrate(&Project{})
	db.AutoMigrate(&Recording{})
	db.AutoMigrate(&Voice{})
	db.AutoMigrate(&ErrorEvent{})

	rooms = NewRooms()

	router = gin.Default()
	if debug {
		pprof.Register(router)
	}

	ws := melody.New()
	ws.Config.MaxMessageSize = 1024 * 1024 * 1024
	ws.Config.MessageBufferSize = 16
	router.GET("/api/rooms/:roomKey/user/:userToken/websocket", func(c *gin.Context) {
		ws.HandleRequestWithKeys(c.Writer, c.Request, map[string]interface{}{
			"roomKey":   c.Param("roomKey"),
			"userToken": c.Param("userToken"),
		})
	})
	ws.HandleConnect(func(s *melody.Session) {
		roomKey := s.MustGet("roomKey")
		userToken := s.MustGet("userToken")
		room := rooms.Get(roomKey.(string))
		err := room.AddUser(userToken.(string))
		if err != nil {
			panic(fmt.Sprintf("failed to add user: %v", err))
		}
		streamer := media.NewOpusChunkStreamer(s)
		room.Mixer.AddOutput(streamer)
	})
	ws.HandleMessageBinary(func(s *melody.Session, msg []byte) {
		roomKey := s.MustGet("roomKey").(string)
		userToken := s.MustGet("userToken").(string)
		processRoomUserRecording(roomKey, userToken, msg)
	})

	router.StaticFile("/", filepath.Join(uiPath, "index.html"))
	router.StaticFile("/r", filepath.Join(uiPath, "room.html"))
	router.Static("/ui", uiPath)
	router.Static("/static", staticPath)
	router.GET("/p/:projectKey", serveIndex)
	router.GET("/r/:roomKey", serveRoom)
	router.GET("/api/project/:projectKey", getProject)
	router.POST("/api/project/:projectKey/recording", saveRecordingMetadata)
	router.PUT("/api/project/:projectKey/recording/:recordingToken", saveRecordingFile)
	router.POST("/api/errors", saveErrorEvent)
	router.Run(listen)
}

func serveIndex(c *gin.Context) {
	c.Request.URL.Path = "/"
	log.Printf("User Agent %s", c.GetHeader("User-Agent"))
	router.HandleContext(c)
}

func serveRoom(c *gin.Context) {
	c.Request.URL.Path = "/r"
	router.HandleContext(c)
}
