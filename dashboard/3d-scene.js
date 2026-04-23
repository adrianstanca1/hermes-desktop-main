import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

export function init3DScene(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const scene = new THREE.Scene();
    
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Create a high-tech wireframe sphere
    const geometry = new THREE.IcosahedronGeometry(1.5, 2);
    const material = new THREE.MeshBasicMaterial({ 
        color: 0x66fcf1, 
        wireframe: true,
        transparent: true,
        opacity: 0.5
    });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    // Inner glowing core
    const innerGeo = new THREE.IcosahedronGeometry(0.8, 1);
    const innerMat = new THREE.MeshBasicMaterial({
        color: 0x45a29e,
        wireframe: true,
        transparent: true,
        opacity: 0.8
    });
    const innerSphere = new THREE.Mesh(innerGeo, innerMat);
    scene.add(innerSphere);

    // Add some floating particles
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 100;
    const posArray = new Float32Array(particlesCount * 3);
    for(let i = 0; i < particlesCount * 3; i++) {
        posArray[i] = (Math.random() - 0.5) * 5;
    }
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particlesMaterial = new THREE.PointsMaterial({
        size: 0.05,
        color: 0x66fcf1,
        transparent: true,
        opacity: 0.6
    });
    const particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particlesMesh);

    // Animation Loop
    let clock = new THREE.Clock();
    
    let targetSpeed = 1.0;
    let currentSpeed = 1.0;
    
    // API for real-time reactivity
    window.Hermes3D = {
        triggerActivity: () => {
            targetSpeed = 5.0; // Spin up
            material.opacity = 0.9;
            innerMat.opacity = 1.0;
            particlesMaterial.size = 0.08;
            
            // Auto cool-down
            setTimeout(() => {
                targetSpeed = 1.0;
            }, 500);
        },
        setHealth: (status) => {
            if (status === 'error') {
                material.color.setHex(0xff4b4b);
                innerMat.color.setHex(0xd90429);
                particlesMaterial.color.setHex(0xff4b4b);
            } else {
                material.color.setHex(0x66fcf1);
                innerMat.color.setHex(0x45a29e);
                particlesMaterial.color.setHex(0x66fcf1);
            }
        }
    };

    function animate() {
        requestAnimationFrame(animate);
        const elapsedTime = clock.getElapsedTime();

        // Smooth speed interpolation
        currentSpeed += (targetSpeed - currentSpeed) * 0.1;
        
        // Cool down opacity
        if (material.opacity > 0.5) material.opacity -= 0.02;
        if (innerMat.opacity > 0.8) innerMat.opacity -= 0.01;
        if (particlesMaterial.size > 0.05) particlesMaterial.size -= 0.001;

        sphere.rotation.y += 0.01 * currentSpeed;
        sphere.rotation.x += 0.005 * currentSpeed;
        
        innerSphere.rotation.y -= 0.015 * currentSpeed;
        innerSphere.rotation.x -= 0.007 * currentSpeed;

        particlesMesh.rotation.y += 0.002 * currentSpeed;

        renderer.render(scene, camera);
    }
    animate();

    // Handle Resize
    window.addEventListener('resize', () => {
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
}
