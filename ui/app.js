function getNoteFrequency(halftonesFromA) {
  const halftoneMultiplier = Math.pow(2, 1/12);
  return 880 * Math.pow(halftoneMultiplier, halftonesFromA);
}

const Index = {
  template: '#index-template',
};
const Project = {
  template: '#project-template',
  data: function() {
    return {
      recording: false,
      recordingAborted: false,
      playing: false,
      uploading: false,
      uploaded: false,
      uploadError: false,
      uploadProgress: null,
      mediaStream: null,
      mediaError: false,
      audioContext: null,
      recordedBlob: null,
      recordedVideoURL: '',
      recordProgress: 0,
      referenceMediaElement: null,
      referenceSource: null,
      referenceGainValue: 25,
      loadReferenceError: false,
      loadReferenceSuccess: false,
      recordedMediaElement: null,
      delay: 0,
      teardownDelay: 2.5, // time to continue recording after reference ended
      startupDelay: 1, // time until metronome starts
      metronomeSources: [],
      delaySliderVisible: false,
      retryVisible: false,
      accuracyCheckVisible: false,
      step: 1,
      videoPreviewDialog: false,
      // loaded via json:
      project: {},
      loadProjectError: null,
      // to be submitted at the end:
      voice: null,
      participantName: '',
      useVideo: false,
      videoSupported: false,
    };
  },
  computed: {
    playbackSupported: function() {
      return !!this.audioContext;
    },
    videoWidth: function() {
      switch (this.$vuetify.breakpoint.name) {
        case 'xs': return 140;
        case 'sm': return 200;
        default: return 500;
      };
    },
  },
  methods: {
    toggleRecord: function() {
      this.recording = !this.recording;
      if (this.recording) {
        this.startRecording();
      } else {
        this.abortRecording();
      }
    },
    onMedia: function(stream) {
      this.mediaStream = stream;
    },
    startRecording: function() {
      this.uploaded = false;
      this.delaySliderVisible = false;
      this.retryVisible = false;
      this.accuracyCheckVisible = false;
      this.recordingAborted = false;
      this.stopReference();
      this.stopRecorded();
      this.recordedBlob = null;
      this.recordedVideoURL = '';
      var config = {
        type: this.videoSupported && this.useVideo ? 'video' : 'audio',
        audioBitsPerSecond: 192*1000,
        videoBitsPerSecond: 1024*1000,
      }
      this.recordRTC = RecordRTC(this.mediaStream, config);

      var startTime = this.audioContext.currentTime + this.startupDelay;
      this.recordRTC.startRecording(); // no way to schedule that start, so just start now
      this.startMetronome(startTime);
      var onended = function() {
        if (this.recordingAborted) {
          this.recording = false;
          this.recordRTC.stopRecording(function() {});
          this.recordProgress = 0;
          return;
        }
        window.setTimeout(function() {
          this.recording = false;
          // wait some time before stopping recording because playback may
          // be delayed.
          this.recordRTC.stopRecording(function() {
            if (!this.recordingAborted) {
              this.recordedBlob = this.recordRTC.getBlob();
              this.step = 3;
            }
            if (this.project.WantVideo && this.videoSupported && this.useVideo) {
              this.recordedVideoURL = URL.createObjectURL(this.recordedBlob);
            }
            this.recordProgress = 0;
          }.bind(this));
        }.bind(this), this.teardownDelay*1000);
      }.bind(this);
      this.playReference(startTime + this.getTimeToBeat(this.project.BeatsBeforeStart), 1, onended);
      this.updateRecordProgress();
    },
    updateRecordProgress: function() {
      if (!this.recording) return;
      this.recordProgress = 100 * this.referenceMediaElement.currentTime / this.referenceMediaElement.duration;
      window.setTimeout(this.updateRecordProgress.bind(this), 500);
    },
    getTimeToBeat: function(beat) {
      return beat * 60/this.project.BeatsPerMinute;
    },
    startMetronome: function(startTime) {
      this.stopMetronome();
      var gain = this.audioContext.createGain();
      gain.gain.value = 0.2;
      gain.connect(this.audioContext.destination);
      this.metronomeSources.push(gain);
      const tickLength = 60/this.project.BeatsPerMinute/8;
      for (var beat = 0; beat < this.project.BeatsBeforeStart; beat++) {
        var src = this.audioContext.createOscillator();
        src.frequency.value = this.project.BeepFrequency;
        if ((beat % this.project.BeatsPerMeasure) != 0) {
          src.frequency.value = this.project.BeepFrequency/2;
        }
        src.connect(gain);
        var beatStartTime = startTime + this.getTimeToBeat(beat);
        src.start(beatStartTime);
        src.stop(beatStartTime + tickLength);
        this.metronomeSources.push(src);
      }
    },
    stopMetronome: function() {
      for (var i = 0; i < this.metronomeSources.length; i++) {
        this.metronomeSources[i].disconnect();
      }
      this.metronomeSources = [];
    },
    abortRecording: function() {
      this.recordingAborted = true;
      this.recordRTC.stopRecording(function() {
        this.recording = false;
      }.bind(this));
      this.stopMetronome();
      this.stopReference();
      this.recordedBlob = null;
      this.recordProgress = 0;
    },
    playRecorded: function() {
      var startTime = this.audioContext.currentTime + this.startupDelay;

      this.stopRecorded();
      this.recordedMediaElement = new Audio();
      this.recordedMediaElement.oncanplaythrough = function() {
        this.recordedMediaElement.oncanplaythrough = null;
        this.recordedMediaElement.currentTime += this.startupDelay + this.getTimeToBeat(this.project.BeatsBeforeStart)
        this.recordedMediaElement.addEventListener('ended', function() {
          console.log("recorded player ended");
          this.playing = false;
        }.bind(this));
        window.setTimeout(function() {
          if (this.playing) {
            this.recordedMediaElement.play();
          }
        }.bind(this), 1000*(startTime - this.audioContext.currentTime));
      }.bind(this);
      this.recordedSource = this.audioContext.createMediaElementSource(this.recordedMediaElement);
      this.recordedSource.connect(this.audioContext.destination);
      this.recordedMediaElement.src = URL.createObjectURL(this.recordedBlob);
      this.recordedMediaElement.preload = 'auto';
      this.playReference(startTime + this.delay/1000, this.referenceGainValue/100);
    },
    stopRecorded: function() {
      if (this.recordedMediaElement) {
        this.recordedMediaElement.pause();
        this.recordedSource.disconnect();
      }
      this.stopReference();
    },
    togglePlayRecorded: function() {
      this.playing = !this.playing;
      if (this.playing) {
        this.accuracyCheckVisible = true;
        this.playRecorded();
      } else {
        this.stopRecorded();
      }
    },
    upload: function() {
      this.uploading = true;
      this.uploadError = false;
      this.uploadMetadata();
    },
    uploadMetadata: function() {
      var metadata = {
        VoiceID: this.voice.ID,
        ParticipantName: this.participantName,
        OffsetMsec: this.delay,
        HasVideo: this.useVideo,
      };
      fetch('/api/project/' + this.$route.params.project_key + '/recording', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
      })
      .then(async (d) => {
        if (d && d.status == 201 && d.ok) {
          var m = await d.json();
          this.uploadRecording(m);
          return;
        }
        this.uploadError = true;
        console.log("uploadMeta: Upload error (unsuccessful return code)", d);
        var e = new Error();
        sendErrorEvent({
          Source: 'app.js:uploadMetadata:fetch',
          Message: 'status',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: d,
        });
      })
      .catch((e) => {
        console.log('Upload error:', e);
        this.uploading = false;
        this.uploadError = true;
        sendErrorEvent({
          Source: 'app.js:uploadMetadata:fetch',
          Message: 'catch',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: e,
        });
      });
    },
    uploadRecording: function(m) {
      this.uploadProgress = null;
      // We have to use XHR because fetch() doesn't support upload progress in 2020.
      var xhr = new XMLHttpRequest();
      if (xhr.upload) {
        xhr.upload.onprogress = function(e) {
          this.uploadProgress = 100 * e.loaded / e.total;
          console.log(this.uploadProgress);
        }.bind(this);
        xhr.upload.onerror = function(e) {
          this.uploading = false;
          this.uploadError = true;
          sendErrorEvent({
            Source: 'app.js:uploadRecording:xhr.upload',
            Message: 'onerror',
            URI: e.fileName,
            Line: e.lineNumber,
            Column: e.columnNumber,
            ErrorObject: e,
          });
        }.bind(this);
      }
      xhr.onload = function() {
        this.uploading = false;
        if (xhr.status == 200) {
          this.uploaded = true;
          return;
        }
        this.uploadError = true;
        console.log("uploadRecording: Upload error (unsuccessful return code)", xhr);
        var e = new Error();
        sendErrorEvent({
          Source: 'app.js:uploadRecording:xhr',
          Message: 'onload',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: {
            'status': xhr.status,
            'responseText': xhr.responseText,
          },
        });
      }.bind(this);
      xhr.onerror = function(e) {
        this.uploading = false;
        this.uploadError = true;
        sendErrorEvent({
          Source: 'app.js:uploadRecording:xhr.upload',
          Message: 'onerror',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: e,
        });
      }.bind(this);
      xhr.responseType = 'json';
      xhr.open('PUT', '/api/project/' + this.$route.params.project_key + '/recording/' + m.RecordingID);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.send(this.recordedBlob);
    },
    downloadRecording: function() {
      invokeSaveAsDialog(this.recordedBlob, 'recording.webm');
    },
    playReference: function(startTime, gain, onended) {
      this.stopReference();
      this.referenceMediaElement.currentTime = 0;
      this.referenceGain.gain.value = gain;
      this.referenceMediaElement.onended = onended;
      window.setTimeout(function() {
        // no way to schedule an exact start
        this.referenceMediaElement.play();
      }.bind(this), 1000*(startTime - this.audioContext.currentTime));
    },
    stopReference: function() {
      this.referenceMediaElement.pause();
    },
    setupMedia: function() {
      // Chromium only allows initialization after a user input:
      this.audioContext = new AudioContext();

      var constraints = {
        audio: {},
      };
      var supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
      console.log(supportedConstraints);
      if (supportedConstraints.autoGainControl) {
        constraints.audio.autoGainControl = false;
      }
      if (supportedConstraints.noiseSuppression) {
        constraints.audio.noiseSuppression = false;
      }
      if (!/Chrome.* Mobile/.test(navigator.userAgent)) {
        // at least in Chrome 81/Android, setting these options
        // leads to empty recordings.
        if (supportedConstraints.echoCancellation) {
          constraints.audio.echoCancellation = false;
        }
      }
      if (this.project.WantVideo && this.videoSupported && this.useVideo) {
        constraints.video = {
          width: { min: 120, max: 720, },
          height: { min: 120, max: 720, },
          frameRate: { ideal: 25, max: 30, },
          facingMode: { ideal: 'user', },
        };
      };
      console.log("using constaints:", constraints);
      navigator.mediaDevices.getUserMedia(constraints)
        .then(this.onMedia)
        .catch(function(e) {
          console.log("first getUserMedia call failed:", e);
          sendErrorEvent({
            Source: 'app.js:setupMedia',
            Message: 'getUserMedia:first',
            URI: e.fileName,
            Line: e.lineNumber,
            Column: e.columnNumber,
            ErrorObject: {
              error: e,
              constaints: constraints,
            },
          });
          this.videoSupported = false;
          constaints = {audio: true};
          navigator.mediaDevices.getUserMedia(constraints)
            .then(this.onMedia)
            .catch(function(e) {
              console.log("second getUserMedia call failed:", e);
              this.mediaError = true;
              sendErrorEvent({
                Source: 'app.js:setupMedia',
                Message: 'getUserMedia:second',
                URI: e.fileName,
                Line: e.lineNumber,
                Column: e.columnNumber,
                ErrorObject: {
                  error: e,
                  constaints: constraints,
                },
              });
            }.bind(this));
        }.bind(this));
      var checkMedia = function() {
        if (this.mediaStream !== null) return;
        var e = new Error();
        navigator.mediaDevices.enumerateDevices()
          .then(function(devices) {
            sendErrorEvent({
              Source: 'app.js:setupMedia',
              Message: 'device list',
              URI: e.fileName,
              Line: e.lineNumber,
              Column: e.columnNumber,
              ErrorObject: {
                error: e,
                constaints: constraints,
                devices: devices,
              },
            });
          });
        sendErrorEvent({
          Source: 'app.js:setupMedia',
          Message: 'no mediaStream yet',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: {
            error: e,
            constaints: constraints,
            supportedConstaints: constraints,
          },
        });
      }.bind(this);
      window.setTimeout(checkMedia, 10000);
      window.setTimeout(checkMedia, 20000);
      window.setTimeout(checkMedia, 30000);
      window.setTimeout(checkMedia, 60000);
    },
    onReferenceReady: function() {
      this.referenceMediaElement.oncanplaythrough = null;
      if (this.loadReferenceSuccess) return;
      this.referenceGain = this.audioContext.createGain();
      this.referenceGain.connect(this.audioContext.destination);
      this.referenceSource = this.audioContext.createMediaElementSource(this.referenceMediaElement);
      this.referenceSource.connect(this.referenceGain);
      this.loadReferenceSuccess = true;
    },
    loadReference: function() {
      if (this.voice.ReferenceMedia.length < 1) {
        console.log("loadReference failed:", "empty source list");
        sendErrorEvent({
          Source: 'app.js:loadReference',
          Message: 'empty-source-list',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
        });
        this.loadReferenceError = true;
        return;
      }
      var media = new Audio();
      this.referenceMediaElement = media;
      media.preload = 'auto';
      media.oncanplaythrough = this.onReferenceReady;
      media.onerror = function(e) {
        console.log("loadReference failed:", e);
        sendErrorEvent({
          Source: 'app.js:loadReference',
          Message: 'onerror',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: e,
        });
        this.loadReferenceError = true;
      }.bind(this);
      for (var i = 0; i < this.voice.ReferenceMedia.length; i++) {
        var ref = this.voice.ReferenceMedia[i];
        var s = document.createElement('source');
        s.src = window.location.protocol + "//" + window.location.host + "/static/" + ref.Path;
        s.type = ref.Type;
        media.appendChild(s);
      }
      // As another fallback, we just accept a partially loaded reference file
      // after some time:
      window.setTimeout(function() {
        if (this.loadReferenceSuccess) return; // oncanplaythrough fired already
        var e = new Error();
        sendErrorEvent({
          Source: 'app.js:loadReference:fallback',
          Message: 'canplaythrough did not fire within 3 sec',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: {
            readyState: media.readyState,
          },
        });
        if (media.readyState <= 1) {
          alert("Die Begleitstimme konnte bisher nicht geladen werden. Wir versuchen einfach, trotzdem weiterzumachen. Wenn du allerdings während der Aufnahme keine Begleitstimme hörst, dann brich bitte ab und probiere es später nochmal -- ggf. mit einem anderen Endgerät/Browser (Chrome, Firefox).");
        }
        this.onReferenceReady();
      }.bind(this), 3000);
    },
    loadProject: function() {
      fetch('/api/project/' + this.$route.params.project_key)
      .then(async (d) => {
        if (d && d.status == 200 && d.ok) {
          this.project = await d.json();
          return;
        }
        console.error("Failed to load project", d);
        var e = new Error();
        sendErrorEvent({
          Source: 'app.js:loadProject:fetch',
          Message: 'status',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: {
            status: d.status,
            ok: d.ok,
            body: await d.body,
          },
        });

        if (d && d.status == 404) {
          this.loadProjectError = 'notfound';
        } else {
          this.loadProjectError = 'unknown';
        }
      })
      .catch(async (e) => {
        console.error('Failed to load project', e);
        sendErrorEvent({
          Source: 'app.js:loadProject:fetch',
          Message: 'catch',
          URI: e.fileName,
          Line: e.lineNumber,
          Column: e.columnNumber,
          ErrorObject: e,
        });
        this.loadProjectError = 'unknown';
      });
    },
    checkVideoSupport: function() {
      if (!navigator.mediaDevices) return false;
      if (!navigator.mediaDevices.enumerateDevices) return false;
      navigator.mediaDevices.enumerateDevices().then(function(devices) {
        devices.forEach(function(device) {
          if (device.kind == 'videoinput') {
            this.videoSupported = true;
            this.useVideo = true;
          }
        }.bind(this))
      }.bind(this));
    },
    showVideoPreview: function() {
      this.videoPreviewDialog = true;
      this.$nextTick(function() {
        var v = document.querySelector('video#video-preview');
        v.onloadedmetadata = function() {
          v.play();
        };
        v.srcObject = this.mediaStream;
      }.bind(this));
    },
    hideVideoPreview: function() {
      var v = document.querySelector('video#video-preview');
      v.pause();
      v.srcObject = null;
      this.videoPreviewDialog = false;
    },
  },
  mounted: function() {
    this.loadProject();
    this.checkVideoSupport();
  },
  watch: {
    'project.Ensemble': function() {
      this.$emit('ensemble-update', this.project.Ensemble);
    },
    'delay': function() {
      this.playing = true;
      this.playRecorded();
    },
    'step': function() {
      if (this.step != 2) return;
      if (this.mediaStream !== null) return;
      this.setupMedia();
      this.loadReference();
    },
    'referenceGainValue': function() {
      if (!this.referenceGain) return;
      this.referenceGain.gain.setValueAtTime(this.referenceGainValue/100, this.audioContext.currentTime);
    },
  },
}

const routes = [
  { name: 'Index', path: '/', component: Index },
  { name: 'Project', path: '/p/:project_key', component: Project },
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
      if (/Presto|Edge\/|Trident|iPhone|iPad/.test(window.navigator.userAgent)) {
        return true;
      }
      return false;
    },
  },
  mounted: function() {
    this.supportDialog = this.isProblematicBrowser();
  },
}).$mount('#app');

Vue.component('delay-arrow', {
  template: '#delay-arrow-template',
  props: ['direction', 'fast'],
});
