import numpy as np

from pipeline.render_hero import decimate, face_normals


def sphere(n: int = 40) -> tuple[np.ndarray, np.ndarray]:
    """UV sphere of radius 10 with outward-facing triangles."""
    theta, phi = np.meshgrid(np.linspace(0, np.pi, n), np.linspace(0, 2 * np.pi, n, endpoint=False), indexing="ij")
    vertices = 10 * np.stack([np.sin(theta) * np.cos(phi), np.sin(theta) * np.sin(phi), np.cos(theta)], axis=-1)
    vertices = vertices.reshape(-1, 3)
    index = np.arange(n * n).reshape(n, n)
    faces = []
    for i in range(n - 1):
        for j in range(n):
            a, b, c, d = index[i, j], index[i, (j + 1) % n], index[i + 1, j], index[i + 1, (j + 1) % n]
            faces += [[a, c, b], [b, c, d]]
    faces = np.array(faces)
    return vertices, faces[np.linalg.norm(face_normals(vertices, faces), axis=1) > 1e-9]


def test_decimation_reduces_mesh_and_keeps_outward_orientation():
    vertices, faces = sphere()
    merged, simplified = decimate(vertices, faces, cell=2.5)
    assert len(merged) < len(vertices) and len(simplified) < len(faces)
    outward = np.einsum("ij,ij->i", face_normals(merged, simplified), merged[simplified].mean(axis=1))
    assert (outward > 0).mean() > 0.99


def test_decimation_leaves_no_duplicate_triangles():
    _, simplified = decimate(*sphere(), cell=2.5)
    assert len(np.unique(np.sort(simplified, axis=1), axis=0)) == len(simplified)
