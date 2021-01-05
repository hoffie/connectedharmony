const Room = {
  template: '#room-template',
  data: function() {
    return {
      joining: false,
      participantName: '',
      streamPosition: 30,
    };
  },
  methods: {
    join: function() {
      this.joining = true;
      this.setupMedia();
      this.scheduleNextChunkPlayback();
    },
    scheduleNextChunkPlayback: function() {
      var source = this.audioContext.createBufferSource();
      var request = new XMLHttpRequest();
      request.open('GET', '/api/rooms/' + this.$route.params.room_key + '/user/mytoken/mix/' + this.streamPosition, true); // this request blocks until available

      request.responseType = 'arraybuffer';
      request.onload = function() {
        var audioData = request.response;
        this.audioContext.decodeAudioData(audioData,
          function(buffer) {
            source.buffer = buffer;
            source.connect(this.audioContext.destination);
            var localTimeBudget = 0.150; // s
            var chunkLength = 0.2; // s
            var tmp = request.responseURL.split("/");
            var streamPosition = parseInt(tmp[tmp.length-1]);
            if (!this.streamStartTime) {
              this.streamStartTime = this.audioContext.currentTime;
            }
            if (!this.firstStreamPosition) {
              this.firstStreamPosition = streamPosition;
            }
            source.start(this.streamStartTime + localTimeBudget + (streamPosition - this.firstStreamPosition) * chunkLength);
          }.bind(this),
          function(e){ console.log("Error with decoding audio data: " + e);
        }.bind(this));
        this.streamPosition += 1;
        return this.scheduleNextChunkPlayback();
      }.bind(this);
      request.send();
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
        audioBitsPerSecond: 128*1000,
        ondataavailable: this.uploadChunk,
        timeSlice: 200,
      }
      this.recordRTC = RecordRTC(this.mediaStream, config);

      // FIXME 2020-01-05
      // FIXME wss support
      this.streamWs = new WebSocket('ws://' + window.location.host + '/api/rooms/FIXME/websocket')
      this.streamWs.onerror = function() {
        console.log("uploadRecording: Upload error (unsuccessful return code)", xhr);
        var e = new Error();
      };
      this.streamWs.onmessage = function(msg) {
        //FIXME handle incoming audio
      };
      // FIXME 2020-01-05

      this.recordRTC.startRecording();
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
