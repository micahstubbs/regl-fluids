regl({
  extensions: [
    'OES_texture_float'
  ],
  attributes: {
    alpha: false
  },
  onDone: start
})

function start (err, regl) {
  if (err) {
    alert('Your WebGL implementation does not support float textures, sorry')
    return
  }
  
  camera = reglCamera(regl, {
    center: [0.5, 0.5, 0.5],
    distance: 2.5
  })

  const PARTICLE_RADIUS = 256
  const FIELD_RADIUS = 64 // must be square

  const FIELD_SHAPE = (FIELD_RADIUS * Math.sqrt(FIELD_RADIUS)) | 0

  const NUM_PARTICLES = PARTICLE_RADIUS * PARTICLE_RADIUS

  const particleIdBuffer = regl.buffer((() => {
    const result = new Float32Array(2 * NUM_PARTICLES)
    for (var i = 0; i < NUM_PARTICLES; ++i) {
      result[2 * i] = (0.5 + (i % PARTICLE_RADIUS)) / PARTICLE_RADIUS
      result[2 * i + 1] = (0.5 + Math.floor(i / PARTICLE_RADIUS)) / PARTICLE_RADIUS
    }
    return result
  })())

  const fieldState = (new Array(2)).fill().map(() =>
    regl.framebuffer({
      color: regl.texture({
        shape: [FIELD_SHAPE, FIELD_SHAPE, 4],
        type: 'float'
      }),
      depthStencil: false
    }))

  var fieldIndex = 2

  function currentField () {
    return fieldState[fieldIndex % fieldState.length]
  }

  function prevField () {
    return fieldState[(fieldIndex + fieldState.length - 1) % fieldState.length]
  }

  function cycleField () {
    fieldIndex += 1
  }

  const FIELD_COORD_READ = `
  vec2 fieldCoordRead (vec3 p) {
    float z = p.z * ${Math.sqrt(FIELD_RADIUS)}.0;
    float zf = floor(fract(z) * ${Math.sqrt(FIELD_RADIUS)}.0);
    float zi = floor(z);
    vec2 xy = p.xy;
    return (vec2(zf, zi) + xy) * ${1 / Math.sqrt(FIELD_RADIUS)} + ${0.5 / FIELD_SHAPE};
  }`

  const FIELD_COORD_WRITE = `
  vec2 fieldCoordWrite (vec3 p) {
    float z = p.z * ${Math.sqrt(FIELD_RADIUS)}.0;
    float zf = floor(fract(z) * ${Math.sqrt(FIELD_RADIUS)}.0);
    float zi = floor(z);
    vec2 xy = p.xy;
    vec2 tc = (vec2(zf, zi) + xy) * ${1 / Math.sqrt(FIELD_RADIUS)} + ${0.5 / FIELD_SHAPE};
    return 2.0 * tc - 1.0;
  }`

  const INITIAL_PARTICLE_DATA = (() => {
    const particleData = new Float32Array(NUM_PARTICLES * 4)
    for (var i = 0; i < NUM_PARTICLES; ++i) {
      particleData[4 * i] = Math.random() * ((FIELD_RADIUS - 2) / FIELD_RADIUS) + 1 / FIELD_RADIUS
      particleData[4 * i + 1] = Math.random() * ((FIELD_RADIUS - 2) / FIELD_RADIUS) + 1 / FIELD_RADIUS
      particleData[4 * i + 2] = 0.5
      particleData[4 * i + 3] = 1
    }
    return particleData
  })()

  const particleState = (new Array(3)).fill().map(() =>
    regl.framebuffer({
      color: regl.texture({
        shape: [PARTICLE_RADIUS, PARTICLE_RADIUS, 4],
        type: 'float',
        data: INITIAL_PARTICLE_DATA
      }),
      depthStencil: false
    }))

  var particleIndex = 3

  function currentParticles () {
    return particleState[particleIndex % particleState.length]
  }

  function prevParticles0 () {
    return particleState[(particleIndex - 1) % particleState.length]
  }

  function prevParticles1 () {
    return particleState[(particleIndex - 2) % particleState.length]
  }

  function cycleParticles () {
    particleIndex += 1
  }

  const drawParticleState = regl({
    frag: `
    precision highp float;
    varying vec2 uv;
    uniform sampler2D particleState;
    void main () {
      gl_FragColor = texture2D(particleState, uv);
    }
    `,

    vert: `
    precision highp float;
    attribute vec2 position;
    varying vec2 uv;
    void main () {
      uv = 0.5 * (position + 1.0);
      gl_Position = vec4(position, 0, 1);
    }
    `,

    attributes: {
      position: [
        -4, 0,
        4, 4,
        4, -4
      ]
    },

    uniforms: {
      particleState: currentParticles
    },

    depth: {
      enable: false
    },

    count: 3
  })

  const integrateField = regl({
    framebuffer: currentField,

    frag: `
    precision highp float;
    varying vec3 fieldLoc;
    uniform sampler2D field;

    ${FIELD_COORD_READ}

    vec4 readIndex (vec3 d) {
      return texture2D(field, fieldCoordRead(
        min(vec3(${1 - 1 / FIELD_RADIUS}),
        max(vec3(${1. / FIELD_RADIUS}),
          fieldLoc + d * ${1.0 / FIELD_RADIUS}))));
    }

    void main () {
      gl_FragColor = 0.8 * (
        (readIndex(vec3(-1, 0, 0)) +
        readIndex(vec3(1, 0, 0)) +
        readIndex(vec3(0, -1, 0)) +
        readIndex(vec3(0, 1, 0)) +
        readIndex(vec3(0, 0, -1)) +
        readIndex(vec3(0, 0, 1))) / 12. +
        0.5 * readIndex(vec3(0)));
    }`,

    vert: `
    precision highp float;
    attribute vec3 _fieldLoc;
    varying vec3 fieldLoc;

    ${FIELD_COORD_WRITE}

    void main () {
      fieldLoc = _fieldLoc;
      gl_Position = vec4(fieldCoordWrite(_fieldLoc), 0, 1);
    }`,

    attributes: {
      _fieldLoc: (() => {
        const VERTS = [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 0],
          [0, 1],
          [1, 1]
        ]
        const data = new Float32Array(18 * FIELD_RADIUS)
        var ptr = 0
        for (var i = 0; i < FIELD_RADIUS; ++i) {
          for (var j = 0; j < VERTS.length; ++j) {
            const p = VERTS[j]
            data[ptr++] = p[0]
            data[ptr++] = p[1]
            data[ptr++] = i / FIELD_RADIUS
          }
        }
        return data
      })()
    },

    uniforms: {
      field: prevField
    },

    depth: {
      enable: false,
      mask: false
    },

    blend: {
      enable: false
    },

    primitive: 'triangles',
    offset: 0,
    elements: null,
    count: 6 * FIELD_RADIUS
  })

  const integrateParticles = regl({
    framebuffer: currentParticles,

    frag: `
    precision highp float;
    varying vec2 uv;
    uniform sampler2D particleState[2];
    uniform sampler2D field;

    ${FIELD_COORD_READ}

    float fieldValue (vec3 p) {
      return texture2D(field, fieldCoordRead(p)).a;
    }

    vec3 fieldGrad (vec3 p) {
      #define DX ${1 / FIELD_RADIUS}
      return vec3(
        fieldValue(p + vec3(DX, 0, 0)) - fieldValue(p - vec3(DX, 0, 0)),
        fieldValue(p + vec3(0, DX, 0)) - fieldValue(p - vec3(0, DX, 0)),
        fieldValue(p + vec3(0, 0, DX)) - fieldValue(p - vec3(0, 0, DX))) / DX;
    }

    vec3 force (vec3 p) {
      return 0.001 * vec3(0.5 - p.z, 0, p.x - 0.5) - 0.00001 * fieldGrad(p) - 0.001 * vec3(0, 1, 0);
    }

    vec3 inBounds (vec3 p) {
      return step(vec3(${1 / FIELD_RADIUS}), p) *
        step(p, vec3(${1 - 1 / FIELD_RADIUS}));
    }

    void main () {
      vec4 state0 = texture2D(particleState[0], uv);
      vec4 state1 = texture2D(particleState[1], uv);

      vec3 p0 = state0.xyz;
      vec3 p1 = state1.xyz;

      vec4 fieldValue = texture2D(field, fieldCoordRead(p0));
      vec3 fieldVelocity = fieldValue.xyz;

      vec3 v = 0.95 * mix(p0 - p1, fieldVelocity, 0.1);
      vec3 f = 0.1 * force(p0);

      vec3 p = p0 + v + f;
      p = mix(2. * p0 - p, p, inBounds(p));
      p = mix(p1, p, inBounds(p));

      gl_FragColor = vec4(p, 1.0);
    }
    `,

    vert: `
    precision highp float;
    attribute vec2 position;
    varying vec2 uv;
    void main () {
      uv = 0.5 * (position + 1.);
      gl_Position = vec4(position, 0, 1);
    }
    `,

    uniforms: {
      'particleState[0]': prevParticles0,
      'particleState[1]': prevParticles1,
      field: currentField
    },

    attributes: {
      position: [
        -4, 0,
        4, 4,
        4, -4
      ]
    },

    count: 3,
    offset: 0,
    primitive: 'triangles',
    elements: null
  })

  const drawParticleSprites = regl({
    frag: `
    precision highp float;
    varying vec3 color;
    void main () {
      gl_FragColor = vec4(color, 1);
    }`,

    vert: `
    precision highp float;
    attribute vec2 id;
    varying vec3 color;
    uniform sampler2D particleState[2];
    uniform mat4 projection, view;
    void main () {
      vec4 state0 = texture2D(particleState[0], id);
      vec4 state1 = texture2D(particleState[1], id);
      color = 0.5 * (1. + normalize(state0.xyz - state1.xyz));
      gl_Position = projection * view * vec4(state0.xyz, 1);
      gl_PointSize = 4.;
    }`,

    attributes: {
      id: particleIdBuffer
    },

    uniforms: {
      'particleState[0]': currentParticles,
      'particleState[1]': prevParticles0
    },

    count: NUM_PARTICLES,
    offset: 0,
    elements: null,
    primitive: 'points'
  })

  const splatParticles = regl({
    frag: `
    precision highp float;
    varying vec4 color;
    void main () {
      gl_FragColor = color;
    }`,

    vert: `
    precision highp float;
    attribute vec2 id;
    varying vec4 color;
    uniform sampler2D particleState[2];

    ${FIELD_COORD_WRITE}

    void main () {
      vec4 state0 = texture2D(particleState[0], id);
      vec4 state1 = texture2D(particleState[1], id);
      color = vec4(state0.xyz - state1.xyz, 1.);
      gl_Position = vec4(fieldCoordWrite(fract(state0.xyz)), 0, 1);
    }`,

    blend: {
      enable: true,
      func: {
        src: 1,
        dst: 1
      },
      equation: 'add'
    },

    depth: {
      enable: false,
      mask: false
    },

    attributes: {
      id: particleIdBuffer
    },

    uniforms: {
      'particleState[0]': currentParticles,
      'particleState[1]': prevParticles0
    },

    primitive: 'points',
    count: NUM_PARTICLES,
    offset: 0,
    elements: null,

    framebuffer: currentField
  })

  const drawFieldState = regl({
    frag: `
    precision highp float;
    varying vec4 color;
    void main () {
      gl_FragColor = vec4(0.5 * (1. + normalize(color.rgb)), 1);
    }`,

    vert: `
    precision highp float;
    attribute vec3 fieldLoc;
    varying vec4 color;
    uniform mat4 projection, view;
    uniform sampler2D field;
    uniform float t;

    ${FIELD_COORD_READ}

    void main () {
      vec2 c = fieldCoordRead(fieldLoc);
      vec4 state = texture2D(field, c);
      color = state;
      vec3 p = mix(fieldLoc, vec3(8. * c, fieldLoc.z), t);
      gl_Position = projection * view * vec4(p, 1);
      gl_PointSize = 4.;
    }
    `,

    attributes: {
      fieldLoc: (() => {
        const fieldData = new Float32Array(FIELD_SHAPE * FIELD_SHAPE * 3)
        var ptr = 0
        for (var i = 0; i < FIELD_RADIUS; ++i) {
          for (var j = 0; j < FIELD_RADIUS; ++j) {
            for (var k = 0; k < FIELD_RADIUS; ++k) {
              fieldData[ptr++] = i / FIELD_RADIUS
              fieldData[ptr++] = j / FIELD_RADIUS
              fieldData[ptr++] = k / FIELD_RADIUS
            }
          }
        }
        return fieldData
      })()
    },

    uniforms: {
      t: ({tick}) => 0, // 0.5 * (Math.cos(0.1 * tick) + 1),
      field: currentField
    },

    count: FIELD_SHAPE * FIELD_SHAPE,
    offset: 0,
    elements: null,
    primitive: 'points'
  })

  const drawTexture = regl({
    frag: `
    precision highp float;
    varying vec2 uv;
    uniform sampler2D img;
    void main () {
      vec4 color = texture2D(img, uv);

      // gl_FragColor = vec4(0.5 * (1. + normalize(color.rgb)), 1);
      gl_FragColor = vec4(color.a, 0, 0, 1);
    }`,

    vert: `
    precision highp float;
    varying vec2 uv;
    attribute vec2 position;
    void main () {
      uv = 0.5 * (position + 1.);
      gl_Position = vec4(position, 0, 1);
    }`,

    attributes: {
      position: [
        -4, 0,
        4, 4,
        4, -4
      ]
    },

    depth: {
      enable: false,
      mask: false
    },

    uniforms: {
      img: regl.prop('texture')
    },

    count: 3
  })

  const drawFieldLines = regl({
    frag: `
    precision highp float;
    void main () {
      gl_FragColor = vec4(1);
    }`,

    primitive: 'lines',

    framebuffer: null
  })

  regl.frame(() => {
    regl.clear({
      color: [0, 0, 0, 1],
      depth: 1
    })

    splatParticles()
    cycleField()
    integrateField()
    cycleField()
    integrateField()

    cycleParticles()
    integrateParticles()

    camera(() => {
      drawParticleSprites()
      // drawFieldState()
    })

    /*
    drawTexture({ texture: currentField() })
    integrateField(() => {
      drawFieldLines()
    })
    */
  })
}