#pragma once

#include "Scene.hpp"

#include <cstdint>

namespace sundial {

struct Mesh {
    std::vector<SCNVector3> vertices, normals;
    std::vector<uint32_t> indices;
    std::vector<CGPoint> texcoords;
    void point(Vec v, Vec n) {
        vertices.push_back(sceneVector(v));
        normals.push_back(sceneVector(n));
    }
    void texturedPoint(Vec v, Vec n, double u, double t) {
        point(v, n);
        texcoords.push_back(CGPointMake(u,t));
    }
    void quad(uint32_t a, uint32_t b, uint32_t c, uint32_t d) {
        indices.insert(indices.end(), {a,b,c, a,c,d});
    }
    SCNGeometry* geometry(SCNMaterial* material, BOOL lines = NO) const {
        const auto source = [SCNGeometrySource geometrySourceWithVertices:vertices.data() count:vertices.size()];
        const auto normal = [SCNGeometrySource geometrySourceWithNormals:normals.data() count:normals.size()];
        NSData *data = [NSData dataWithBytes:indices.data() length:indices.size()*sizeof(uint32_t)];
        auto element = [SCNGeometryElement geometryElementWithData:data
            primitiveType:lines ? SCNGeometryPrimitiveTypeLine : SCNGeometryPrimitiveTypeTriangles
            primitiveCount:indices.size()/(lines ? 2 : 3) bytesPerIndex:sizeof(uint32_t)];
        NSArray<SCNGeometrySource*>* sources = @[source, normal];
        if (!texcoords.empty()) {
            auto uv = [SCNGeometrySource geometrySourceWithTextureCoordinates:texcoords.data() count:texcoords.size()];
            sources = [sources arrayByAddingObject:uv];
        }
        auto result = [SCNGeometry geometryWithSources:sources elements:@[element]];
        result.materials = @[material];
        return result;
    }
};

inline SCNMaterial* material(Color color, BOOL unlit = NO) {
    auto m = [SCNMaterial material];
    m.lightingModelName = unlit ? SCNLightingModelConstant : SCNLightingModelLambert;
    m.diffuse.contents = color.native();
    m.doubleSided = YES;
    return m;
}

inline void applyTexture(SCNMaterial* material, NSImage* image, double repeats = 1) {
    material.diffuse.contents = image;
    material.diffuse.minificationFilter = SCNFilterModeLinear;
    material.diffuse.mipFilter = SCNFilterModeLinear;
    material.diffuse.maxAnisotropy = 8;
    material.diffuse.wrapS = material.diffuse.wrapT = SCNWrapModeRepeat;
    material.diffuse.contentsTransform = SCNMatrix4MakeScale(repeats, repeats, 1);
}

inline SCNNode* meshNode(SCNNode* parent, const Mesh& mesh, SCNMaterial* surface) {
    auto node = [SCNNode nodeWithGeometry:mesh.geometry(surface)];
    [parent addChildNode:node];
    return node;
}

} // namespace sundial
