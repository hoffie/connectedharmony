const Room = {
  template: '#room-template',
  data: function() {
    return {
      joining: false,
      participantName: '',
      streamPosition: 0,
      recording: false,
    };
  },
  methods: {
    join: function() {
      this.joining = true;
      this.setupMedia();
    },
    setupMedia: function() {
      // Chromium only allows initialization after a user input:
      this.audioContext = new AudioContext();

      var constraints = {
        audio: {
          channels: 1,
        },
      };
      var supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
      if (supportedConstraints.autoGainControl) {
        constraints.audio.autoGainControl = false;
      }
      if (supportedConstraints.noiseSuppression) {
        constraints.audio.noiseSuppression = false;
      }
      if (supportedConstraints.echoCancellation) {
        constraints.audio.echoCancellation = false;
      }
      console.log("using constaints:", constraints);
      navigator.mediaDevices.getUserMedia(constraints)
        .then(this.onMedia)
        .catch(function(e) {
          console.log("first getUserMedia call failed:", e);
        }.bind(this));
    },
    onMedia: function(stream) {
      this.mediaStream = stream;
      var config = {
        type: 'audio',
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128*1000,
        ondataavailable: this.uploadChunk,
        timeSlice: 200,
      }
      this.recordRTC = RecordRTC(this.mediaStream, config);

      // FIXME wss support
      this.streamWs = new WebSocket('ws://' + window.location.host + '/api/rooms/FIXME/websocket')
      this.streamWs.binaryType = 'arraybuffer';
      this.streamWs.onerror = function(err) {
        console.log("uploadRecording: Upload error (unsuccessful return code)", err);
        var e = new Error();
      };
      //FIXME monitor bufferedAmount
      this.streamWs.onmessage = this.scheduleChunkPlayback;
    },
    scheduleChunkPlayback: function(event) {
      var audioData = event.data;
      var source = this.audioContext.createBufferSource();
      this.audioContext.decodeAudioData(audioData,
        function(buffer) {
          source.buffer = buffer;
          source.connect(this.audioContext.destination);
          var localTimeBudget = 0.150; // s
          var chunkLength = 0.2; // s
          if (!this.streamStartTime) {
            this.streamStartTime = this.audioContext.currentTime;
          }
          this.streamPosition++;
          var startTime = this.streamStartTime + localTimeBudget + this.streamPosition * chunkLength
          source.start(startTime);
          if (this.recording) {
            return;
          }
          this.recording = true;
          var recorderRampUpTime = 0.01;
          var timeToStart = startTime - this.audioContext.currentTime - recorderRampUpTime;
          window.setTimeout(function() {
            this.recordRTC.startRecording();
          }.bind(this), timeToStart);
        }.bind(this),
        function(e){ console.log("Error with decoding audio data: " + e);
      }.bind(this));
    },
    uploadChunk: function(blob) {
      this.streamWs.send(blob);
      // clean up to avoid memory leaks:
      this.recordRTC.getInternalRecorder().getArrayOfBlobs().splice(0)
    },
  },
}

const routes = [
  { name: 'Room', path: '/r/:room_key', component: Room },
]

const router = new VueRouter({
  mode: "history",
  routes
})


const app = new Vue({
  router,
  vuetify: new Vuetify({
    theme: {
      themes: {
        light: {
          primary: '#F57C00',
          secondary: '#78909C',
          accent: '#D84315',
        },
      },
    },
  }),
  template: '#app-template',
  data: function() {
    return {
      ensemble: '',
      aboutDialog: false,
      supportDialog: false,
    };
  },
  methods: {
    setEnsemble: function(e) {
      this.ensemble = e;
    },
    isProblematicBrowser: function() {
      if (!navigator.mediaDevices.getUserMedia) {
        return true;
      }
      if (!window.MediaStreamRecorder || !window.AudioContext) {
        return true;
      }
      if (/Presto|Edge\/|Trident|iPhone|iPad|Macintosh.*Version\/|FxiOS/.test(window.navigator.userAgent)) {
        return true;
      }
      return false;
    },
  },
  mounted: function() {
    this.supportDialog = this.isProblematicBrowser();
  },
}).$mount('#app');
