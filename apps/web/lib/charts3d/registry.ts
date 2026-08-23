/**
 * Every spatial visualization this system can name, and what draws it (§9, §10).
 *
 * The brief lists around two hundred and fifty named visualizations. They are
 * not two hundred and fifty components — building one renderer per name would
 * give two hundred and fifty motion languages, two hundred and fifty sets of
 * bugs, and a product where a scatter and a bubble plot behave differently for
 * no reason a researcher could explain.
 *
 * They reduce to **nine primitives**. A saddle surface, a loss landscape, a
 * regression plane, a yield curve and terrain are one primitive with different
 * data. A force field, a wind field and a gradient are one primitive with
 * different units. Recognising that is what makes "everything" a tractable
 * build rather than a permanent backlog.
 *
 * **This file is the answer to "do we have it".** Every name in the brief
 * appears here exactly once, with the primitive that draws it, the data it
 * needs, and an honest status. A test asserts the catalogue is complete and
 * internally consistent, so the question stops being a matter of memory — which
 * is how §74 and §75 sat recorded as unreviewed while their code was finished
 * and unreachable.
 *
 * **Gesture is not per-chart.** Anything implementing `VisualizationController`
 * is manipulable by hand, pointer, voice and AI already, because §2 requires
 * every input to resolve into the same command. A new primitive earns rotation,
 * selection, region-select and focus by existing, not by wiring.
 */

/** The nine things that actually draw. */
export type Primitive =
  /** Positioned marks: scatter, embeddings, point clouds, particles. */
  | "points"
  /** Connected paths: curves, trajectories, orbits, streamlines. */
  | "lines"
  /** A height field or mesh: z = f(x,y), terrain, regression planes. */
  | "surface"
  /** Extruded quantities standing on a plane. */
  | "bars"
  /** Oriented marks carrying direction and magnitude at sample points. */
  | "glyphs"
  /** A scalar field sampled through a box, drawn by transmission. */
  | "volume"
  /** A single value of a scalar field, drawn as a closed shell. */
  | "isosurface"
  /** Nodes and edges placed in space. */
  | "network"
  /** Imported geometry: CAD, anatomy, molecules. */
  | "mesh";

/**
 * What has to exist before a primitive can draw anything.
 *
 * Recorded because the commonest reason a visualization cannot be offered is
 * not a missing renderer — it is that nothing in the project produces the shape
 * it needs. Saying so is more useful than an empty chart.
 */
export type DataShape =
  | "xyz"          // one row per observation
  | "xyzv"         // positions with a value
  | "grid"         // a regular lattice of heights
  | "field"        // vectors sampled on a lattice
  | "voxels"       // a scalar sampled through a box
  | "graph"        // nodes and edges
  | "geometry"     // vertices and faces from a file
  | "series";      // ordered values, for extrusion

export type Status =
  /** Drawable today. */
  | "built"
  /** The primitive exists; this is a configuration of it not yet exposed. */
  | "configuration"
  /** The primitive itself is not written yet. */
  | "primitive-missing"
  /**
   * Needs a specialist library — Mol*, vtk.js, a CAD kernel.
   *
   * Separated because the cost is different in kind: not an afternoon of
   * geometry but a format, a viewer, a maintenance burden and tens of
   * megabytes. Worth paying when a researcher arrives with the file, and not
   * before.
   */
  | "needs-library";

export type Spatial =
  /** The data has three meaningful dimensions. */
  | "inherently"
  /**
   * Two dimensions, shown in a spatial frame.
   *
   * §10 is explicit: never convert an ordinary chart to 3D to look futuristic,
   * because depth buys occlusion, perspective distortion and ambiguity. These
   * are listed so the catalogue can say plainly that the third axis is the
   * room, not the data.
   */
  | "framed";

export type Visualization = {
  name: string;
  primitive: Primitive;
  needs: DataShape;
  spatial: Spatial;
  status: Status;
  /** The family the brief groups it under, for a toolbox that reads sensibly. */
  family: string;
  /**
   * Whether it varies over time.
   *
   * Animation is a dimension over the primitives rather than a primitive of its
   * own: an animated scatter is a scatter whose positions are a function of a
   * clock. Marking it here keeps the catalogue from growing a parallel set of
   * entries that differ only by moving, and tells a renderer it needs a
   * timeline rather than a still frame.
   */
  animated?: boolean;
  /** Why this is the right primitive, where it is not obvious. */
  note?: string;
};

/*
 * The catalogue.
 *
 * Grouped as the brief groups them so an entry can be found by the name a
 * researcher would use, and so nothing is quietly dropped when the list is
 * compared against it.
 */
export const CATALOGUE: Visualization[] = [
  // 1. Core 3D data ---------------------------------------------------------
  { name: "3D scatter", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Core" },
  { name: "3D bubble", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Core", note: "Scatter with the value bound to size." },
  { name: "3D density", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Core", note: "Scatter with the value bound to opacity." },
  { name: "3D line", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Core" },
  { name: "3D stem", primitive: "lines", needs: "xyz", spatial: "framed", status: "primitive-missing", family: "Core", note: "A line per observation, dropped to the base plane." },
  { name: "3D surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Core" },
  { name: "3D mesh", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Core" },
  { name: "3D wireframe", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Core", note: "The surface drawn as edges rather than faces." },
  { name: "3D contour", primitive: "surface", needs: "grid", spatial: "framed", status: "configuration", family: "Core", note: "Level curves of the same height field." },
  { name: "3D filled contour", primitive: "surface", needs: "grid", spatial: "framed", status: "configuration", family: "Core" },
  { name: "3D bar", primitive: "bars", needs: "series", spatial: "framed", status: "primitive-missing", family: "Core" },
  { name: "3D column", primitive: "bars", needs: "series", spatial: "framed", status: "primitive-missing", family: "Core" },
  { name: "3D area", primitive: "surface", needs: "series", spatial: "framed", status: "configuration", family: "Core" },
  { name: "3D ribbon", primitive: "surface", needs: "series", spatial: "framed", status: "configuration", family: "Core", note: "One narrow surface per series, offset in depth." },
  { name: "3D waterfall", primitive: "bars", needs: "series", spatial: "framed", status: "primitive-missing", family: "Core" },

  // 2. Mathematical ---------------------------------------------------------
  { name: "Function surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Mathematical", note: "z = f(x,y) sampled onto a lattice." },
  { name: "Parametric surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Mathematical" },
  { name: "Parametric curve", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Mathematical" },
  { name: "Implicit surface", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Mathematical", note: "The zero level of f(x,y,z)." },
  { name: "Saddle surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Mathematical" },
  { name: "Paraboloid", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Mathematical" },
  { name: "Hyperboloid", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Mathematical", note: "Two sheets: not a height field, so not a surface." },
  { name: "Plane", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Mathematical" },
  { name: "Sphere", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Mathematical" },
  { name: "Ellipsoid", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Mathematical" },
  { name: "Torus", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Mathematical" },
  { name: "Gradient field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Mathematical" },
  { name: "Vector function", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Mathematical" },
  { name: "Jacobian", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Mathematical" },
  { name: "Hessian", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Mathematical", note: "Curvature as a height field over the domain." },
  { name: "Optimization landscape", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Mathematical" },
  { name: "Loss landscape", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Mathematical" },
  { name: "Constraint surface", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Mathematical" },
  { name: "Surface intersection", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Mathematical", note: "The intersection is a curve; the surfaces are drawn beside it." },
  { name: "Multivariable function", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Mathematical" },

  // 3. Vector and field -----------------------------------------------------
  { name: "3D vector field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Arrow field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Streamline", primitive: "lines", needs: "field", spatial: "inherently", status: "primitive-missing", family: "Fields", note: "Paths integrated through the field, then drawn as lines." },
  { name: "Streamtube", primitive: "surface", needs: "field", spatial: "inherently", status: "configuration", family: "Fields", note: "A surface swept along an integrated streamline. The renderer exists; turning a field into the tube is a data step, not a new primitive." },
  { name: "Flow field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Velocity field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Acceleration field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Force field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Magnetic field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Electric field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Gravitational field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Fluid flow", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Wind field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields" },
  { name: "Particle flow", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Fields", note: "Points advected through a field over time." },
  { name: "Tensor field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Fields", note: "An ellipsoid glyph per sample rather than an arrow." },

  // 4. Volume ---------------------------------------------------------------
  { name: "Volume rendering", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Volume" },
  { name: "Voxel plot", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Volume" },
  { name: "Isosurface", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Volume" },
  { name: "Multi-isosurface", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Volume" },
  { name: "Density volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Volume" },
  { name: "Scalar field volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Volume" },
  { name: "Temperature volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Volume" },
  { name: "Pressure volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Volume" },
  { name: "Seismic volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Volume" },
  { name: "Atmospheric volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Volume" },
  { name: "CT volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "needs-library", family: "Volume", note: "The primitive draws it; DICOM reading is the library." },
  { name: "MRI volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "needs-library", family: "Volume", note: "NIfTI reading is the library." },
  { name: "PET volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "needs-library", family: "Volume" },

  // 5. Statistical ----------------------------------------------------------
  { name: "3D histogram", primitive: "bars", needs: "grid", spatial: "framed", status: "primitive-missing", family: "Statistical" },
  { name: "Probability distribution", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "Multivariate distribution", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "Gaussian surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "Kernel density surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "Confidence surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Statistical", note: "Two surfaces, drawn as a band." },
  { name: "Regression plane", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "Nonlinear regression surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "Residual surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "Cluster visualization", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "PCA 3D", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "t-SNE 3D", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "UMAP 3D", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "Multidimensional scaling", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Statistical" },
  { name: "3D correlation", primitive: "surface", needs: "grid", spatial: "framed", status: "configuration", family: "Statistical" },
  { name: "Outlier space", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Statistical" },

  // 6. Machine learning -----------------------------------------------------
  { name: "Embedding space", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Machine learning" },
  { name: "Latent space", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Machine learning" },
  { name: "Feature space", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Machine learning" },
  { name: "Feature clusters", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Machine learning" },
  { name: "Decision surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Machine learning" },
  { name: "Decision boundary", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Machine learning", note: "In three inputs the boundary is a shell, not a height field." },
  { name: "Classification regions", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Machine learning" },
  { name: "Training trajectory", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Machine learning" },
  { name: "Gradient flow", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Machine learning" },
  { name: "Neural network graph", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Machine learning" },
  { name: "Transformer architecture", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Machine learning" },
  { name: "Attention graph", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Machine learning" },
  { name: "Model architecture graph", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Machine learning" },
  { name: "Activation visualization", primitive: "surface", needs: "grid", spatial: "framed", status: "configuration", family: "Machine learning" },

  // 7. Networks -------------------------------------------------------------
  { name: "3D network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "3D knowledge graph", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "Citation network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "Research paper network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "Concept graph", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "Dependency graph", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Networks" },
  { name: "Social network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "Biological interaction network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "Protein interaction network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "Gene interaction network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "Neural connectivity", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks" },
  { name: "Supply chain network", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Networks" },
  { name: "Computer network", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Networks" },
  { name: "Communication network", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Networks" },
  { name: "Hierarchical network", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Networks" },
  { name: "Temporal network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Networks", note: "A graph whose edges appear and vanish over time." },

  // 8. Geographic -----------------------------------------------------------
  { name: "3D globe", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Geographic" },
  { name: "3D terrain", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Geographic" },
  { name: "Elevation map", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Geographic" },
  { name: "Bathymetric map", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Geographic" },
  { name: "Population globe", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Geographic" },
  { name: "Climate globe", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Geographic" },
  { name: "Weather visualization", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Geographic" },
  { name: "Wind visualization", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Geographic" },
  { name: "Ocean currents", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Geographic" },
  { name: "Geological layers", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Geographic" },
  { name: "Seismic visualization", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Geographic" },
  { name: "Satellite orbits", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Geographic" },
  { name: "Flight paths", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Geographic" },
  { name: "Shipping network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Geographic" },
  { name: "Urban 3D map", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Geographic" },
  { name: "Geographic heat map", primitive: "surface", needs: "grid", spatial: "framed", status: "built", family: "Geographic" },

  // 9. Physics --------------------------------------------------------------
  { name: "Particle simulation", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Physics" },
  { name: "N-body simulation", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Physics" },
  { name: "Orbital simulation", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Physics" },
  { name: "Wave simulation", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Physics" },
  { name: "Electromagnetic field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Physics" },
  { name: "Fluid simulation", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Physics" },
  { name: "Turbulence", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Physics" },
  { name: "Heat transfer", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Physics" },
  { name: "Stress field", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Physics" },
  { name: "Pressure field", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Physics" },
  { name: "Quantum probability", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Physics" },
  { name: "Spacetime curvature", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Physics" },
  { name: "Collision simulation", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Physics" },
  { name: "Rigid body simulation", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Physics" },

  // 10. Engineering ---------------------------------------------------------
  { name: "CAD model", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Mechanical assembly", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Exploded assembly", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Finite element analysis", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Stress visualization", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Strain visualization", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Thermal analysis", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "CFD visualization", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Engineering" },
  { name: "Airflow", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Engineering" },
  { name: "Pressure distribution", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Vibration analysis", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Modal analysis", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Structural deformation", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Digital twin", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Robotics workspace", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Robot arm motion", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Engineering" },
  { name: "Kinematic chain", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Engineering" },
  { name: "Vehicle simulation", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },
  { name: "Aerodynamics", primitive: "glyphs", needs: "field", spatial: "inherently", status: "configuration", family: "Engineering" },
  { name: "Engine simulation", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Engineering" },

  // 11. Chemistry -----------------------------------------------------------
  { name: "3D molecule", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "Ball and stick", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "Space filling", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "Molecular surface", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "Electron density", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Chemistry" },
  { name: "Molecular orbital", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Chemistry" },
  { name: "Protein structure", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "DNA structure", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "RNA structure", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "Protein ligand interaction", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "Docking", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "Crystal structure", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Chemistry" },
  { name: "Reaction pathway", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Chemistry" },
  { name: "Chemical bond network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Chemistry" },
  { name: "Molecular dynamics", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Chemistry" },

  // 12. Medical -------------------------------------------------------------
  { name: "Human anatomy", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Medical" },
  { name: "Organ model", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Medical" },
  { name: "Brain model", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Medical" },
  { name: "Brain connectivity", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Medical" },
  { name: "Neural pathways", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Medical" },
  { name: "Blood vessel network", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Medical" },
  { name: "Cellular model", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Medical" },
  { name: "Tissue volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Medical" },
  { name: "Tumour visualization", primitive: "isosurface", needs: "voxels", spatial: "inherently", status: "primitive-missing", family: "Medical" },
  { name: "CT reconstruction", primitive: "volume", needs: "voxels", spatial: "inherently", status: "needs-library", family: "Medical" },
  { name: "MRI reconstruction", primitive: "volume", needs: "voxels", spatial: "inherently", status: "needs-library", family: "Medical" },
  { name: "Surgical planning", primitive: "mesh", needs: "geometry", spatial: "inherently", status: "needs-library", family: "Medical" },
  { name: "Biological pathway network", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Medical" },
  { name: "Gene expression space", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Medical" },
  { name: "Protein network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Medical" },

  // 13. Astronomy -----------------------------------------------------------
  { name: "Solar system", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Astronomy" },
  { name: "Planetary orbits", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Astronomy" },
  { name: "Star map", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Astronomy" },
  { name: "Galaxy map", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Astronomy" },
  { name: "Milky Way", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Astronomy" },
  { name: "Cosmological simulation", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Astronomy" },
  { name: "Dark matter distribution", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Astronomy" },
  { name: "Gravitational waves", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Astronomy" },
  { name: "Satellite constellation", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Astronomy" },
  { name: "Spacecraft trajectory", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Astronomy" },
  { name: "Asteroid orbits", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Astronomy" },
  { name: "Exoplanet system", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Astronomy" },

  // 14. Time-varying -------------------------------------------------------
  //
  // A fourth dimension, carried by animation rather than by geometry. Each of
  // these is one of the primitives above with a clock attached, which is why
  // none of them adds a tenth primitive to the list.
  { name: "Animated 3D scatter", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Time", animated: true },
  { name: "Animated surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Time", animated: true },
  { name: "Time-varying volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Time", animated: true },
  { name: "Dynamic network", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Time", animated: true },
  { name: "Moving particle system", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Time", animated: true },
  { name: "Simulation timeline", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Time", animated: true, note: "Scrubbed by hand: the clock is the thing being manipulated." },
  { name: "Historical geographic evolution", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Time", animated: true },
  { name: "Real-time sensor visualization", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Time", animated: true },
  { name: "Live experiment visualization", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Time", animated: true },
  { name: "Real-time financial surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Time", animated: true },
  { name: "Time-series landscape", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Time", animated: true },

  // 15. Financial -----------------------------------------------------------
  { name: "Yield curve surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Financial" },
  { name: "Volatility surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Financial" },
  { name: "Option pricing surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Financial" },
  { name: "Portfolio risk landscape", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Financial" },
  { name: "Correlation surface", primitive: "surface", needs: "grid", spatial: "framed", status: "built", family: "Financial" },
  { name: "Market cluster map", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Financial" },
  { name: "Economic indicator landscape", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Financial" },
  { name: "Supply demand surface", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Financial" },
  { name: "Scenario simulation", primitive: "surface", needs: "grid", spatial: "inherently", status: "configuration", family: "Financial" },
  { name: "Risk heat volume", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Financial" },

  // 16. Native to this product ----------------------------------------------
  //
  // The only entries nobody else can build, because they draw this system's own
  // semantic layer rather than somebody's data format. A protein viewer is a
  // commodity; a figure showing which evidence supports which claim is not.
  { name: "Provenance tree", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Native", note: "How a result was made. The lineage already exists." },
  { name: "Research universe", primitive: "points", needs: "xyz", spatial: "inherently", status: "configuration", family: "Native", note: "Objects placed by semantic similarity." },
  { name: "Evidence galaxy", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Native" },
  { name: "Knowledge constellation", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Native" },
  { name: "Hypothesis space", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Native" },
  { name: "Experiment universe", primitive: "points", needs: "xyzv", spatial: "inherently", status: "configuration", family: "Native" },
  { name: "Causal graph space", primitive: "network", needs: "graph", spatial: "inherently", status: "configuration", family: "Native" },
  { name: "Analysis pipeline space", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Native" },
  { name: "AI reasoning workspace", primitive: "network", needs: "graph", spatial: "framed", status: "configuration", family: "Native" },
  { name: "Uncertainty landscape", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Native" },
  { name: "Parameter landscape", primitive: "surface", needs: "grid", spatial: "inherently", status: "built", family: "Native" },
  { name: "Semantic similarity space", primitive: "points", needs: "xyz", spatial: "inherently", status: "built", family: "Native" },
  { name: "Research timeline tunnel", primitive: "lines", needs: "xyz", spatial: "inherently", status: "primitive-missing", family: "Native" },
  { name: "Simulation chamber", primitive: "volume", needs: "voxels", spatial: "inherently", status: "configuration", family: "Native" },
  { name: "Data universe", primitive: "points", needs: "xyzv", spatial: "inherently", status: "built", family: "Native" },
];

/** Everything that needs a clock rather than a still frame. */
export function timeVarying(): Visualization[] {
  return CATALOGUE.filter((v) => v.animated === true);
}

/** Everything drawn by one primitive. */
export function drawnBy(primitive: Primitive): Visualization[] {
  return CATALOGUE.filter((v) => v.primitive === primitive);
}

/** What is drawable today. */
export function available(): Visualization[] {
  return CATALOGUE.filter(
    (v) => v.status === "built" || v.status === "configuration");
}

/**
 * What building one primitive would unlock.
 *
 * The number that should decide what to build next: `glyphs` is one renderer
 * and turns two dozen named visualizations from impossible into available,
 * which is a different proposition from adding one chart.
 */
export function unlockedBy(primitive: Primitive): Visualization[] {
  return CATALOGUE.filter(
    (v) => v.primitive === primitive && v.status === "primitive-missing");
}

/** The primitives still to write, most unlocked first. */
export function buildOrder(): Array<{ primitive: Primitive; unlocks: number }> {
  const counts = new Map<Primitive, number>();
  for (const v of CATALOGUE) {
    if (v.status !== "primitive-missing") continue;
    counts.set(v.primitive, (counts.get(v.primitive) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([primitive, unlocks]) => ({ primitive, unlocks }))
    .sort((a, b) => b.unlocks - a.unlocks);
}
