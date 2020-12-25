const Room = {
  template: '#room-template',
  data: function() {
    return {
      joining: false,
      participantName: '',
      streamPosition: 20,
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
      console.log(request);
      request.onload = function() {
        var audioData = request.response;
        this.audioContext.decodeAudioData(audioData,
          function(buffer) {
            source.buffer = buffer;
            source.connect(this.audioContext.destination);
            if (this.streamPosition == 0) {
              this.streamStartTime = this.audioContext.currentTime;
            }
            var localTimeBudget = 150; // ms
            var chunkLength = 200; // ms
            var tmp = request.responseURL.split("/");
            var streamPosition = parseInt(tmp[tmp.length]);
            source.start(this.streamStartTime + localTimeBudget + streamPosition * chunkLength);
          }.bind(this),
          function(e){ console.log("Error with decoding audio data: " + e);
          this.streamPosition += 1;
          //return this.scheduleNextChunkPlayback();
        }.bind(this));
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
      console.log(supportedConstraints);
      if (supportedConstraints.autoGainControl) {
        constraints.audio.autoGainControl = false;
      }
      if (supportedConstraints.noiseSuppression) {
        constraints.audio.noiseSuppression = false;
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
        timeSlice: 1000,
      }
      this.recordRTC = RecordRTC(this.mediaStream, config);
      console.log(this.recordRTC);
      this.recordRTC.startRecording();
    },
    uploadChunk: function(blob) {
      var uploadStarted = window.performance.now();
      // We have to use XHR because fetch() doesn't support upload progress in 2020.
      var xhr = new XMLHttpRequest();
      xhr.onload = function() {
        var uploadDuration = window.performance.now() - uploadStarted;
        // FIXME only log long durations / add metric
        console.log("upload took " + uploadDuration + " ms");
        if (xhr.status == 200) {
          this.uploaded = true;
          return;
        }
        console.log("uploadRecording: Upload error (unsuccessful return code)", xhr);
        var e = new Error();
      }.bind(this);
      xhr.onerror = function(e) {
        // FIXME handle error
      }.bind(this);
      xhr.responseType = 'json';
      xhr.open('POST', '/api/rooms/' + this.$route.params.room_key + '/user/mytoken/stream');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.send(blob);
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
