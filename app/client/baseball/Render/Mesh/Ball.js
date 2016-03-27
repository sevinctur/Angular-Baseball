import { AbstractMesh } from './AbstractMesh';
import { Loop } from '../Loop';
import { Mathinator } from '../../Services/Mathinator';
import { Indicator } from './Indicator';
import { helper } from '../../Utility/helper';

/**
 * on the DOM the pitch zone is 200x200 pixels
 * here we scale the strike zone to 4.2 units (feet)
 * for display purposes. It is only approximately related to actual pitch zone dimensions.
 * @type {number}
 */
var SCALE = 2.1/100;

var INDICATOR_DEPTH = -5;

class Ball extends AbstractMesh {
    /**
     *
     * @param loop
     * @param trajectory {Array<Vector3>} incremental vectors applied each frame
     * e.g. for 1 second of flight time there should be 60 incremental vectors
     */
    constructor(loop, trajectory) {
        super();
        if (!(loop instanceof Loop) && loop instanceof Array) {
            trajectory = loop;
        }
        this.hasIndicator = false;
        this.trajectory = trajectory ? trajectory : [];
        this.breakingTrajectory = [];
        this.getMesh();
        if (loop instanceof Loop) {
            this.join(loop);
        }
        this.setType('4-seam', 1);
        this.bounce = 1;
    }
    getMesh() {
        /** @see threex.sportballs */
        var baseURL	= 'public/';
        var THREE = window.THREE;
        var loader = new THREE.TextureLoader();
        var textureColor= loader.load(baseURL + 'images/BaseballColor.jpg');
        var textureBump	= loader.load(baseURL + 'images/BaseballBump.jpg');
        var geometry	= new THREE.SphereGeometry(0.36, 32, 16); // real scale is 0.12
        var material	= new THREE.MeshPhongMaterial({
            map	: textureColor,
            bumpMap	: textureBump,
            bumpScale: 0.01
        });
        this.mesh = new THREE.Mesh(geometry, material);
        return this.mesh;
    }

    /**
     * Leave an indicator when crossing the home plate front plane,
     * and rotate while moving (default 1000 RPM)
     */
    animate() {
        var frame = this.trajectory.shift(),
            pos = this.mesh.position;

        if (frame) {
            pos.x += frame.x;
            pos.y += frame.y * this.bounce;
            pos.z += frame.z;
            if (pos.y < AbstractMesh.WORLD_BASE_Y) {
                this.bounce *= -1;
            }
            if (frame.x + frame.y + frame.z !== 0) {
                this.rotate();
            }
        }
        if (pos.z > INDICATOR_DEPTH && !this.hasIndicator) {
            this.spawnIndicator();
        }
        if (!frame) {
            this.detach();
            this.loop.resetCamera();
        }
    }
    setType(type, handednessScalar) {
        var rpm = helper.pitchDefinitions[type][4];
        var rotationAngle = helper.pitchDefinitions[type][3];
        this.setRotation(rpm, rotationAngle * (handednessScalar || 1));
    }
    rotate() {
        var rotation = this.rotation;
        var meshRotation = this.mesh.rotation;
        meshRotation.x += rotation.x;
        meshRotation.y += rotation.y;
    }
    setRotation(rpm, rotationAngle) {
        this.RPM = rpm;
        this.RPS = this.RPM / 60;
        var rotationalIncrement = this.RP60thOfASecond = this.RPS / 60;

        // calculate rotational components
        // +x is CCW along x axis increasing
        // +y is CW along y axis increasing
        // +z (unused) is CW along z axis increasing

        // 0   --> x:1 y:0
        // 45  --> x:+ y:+
        // 90  --> x:0 y:1
        // 180 --> x:-1 y:0

        var xComponent = rotationalIncrement * Math.cos(rotationAngle / 180 * Math.PI);
        var yComponent = rotationalIncrement * Math.sin(rotationAngle / 180 * Math.PI);

        this.rotation = {
            x: xComponent * 360 * Math.PI / 180,
            y: yComponent * 360 * Math.PI / 180
        };
    }
    exportPositionTo(mesh) {
        mesh.position.x = this.mesh.position.x;
        mesh.position.y = this.mesh.position.y;
        mesh.position.z = this.mesh.position.z;
    }
    spawnIndicator() {
        if (this.hasIndicator) {
            return;
        }
        this.hasIndicator = true;
        var indicator = new Indicator();
        indicator.mesh.position.x = this.mesh.position.x;
        indicator.mesh.position.y = this.mesh.position.y;
        indicator.mesh.position.z = this.mesh.position.z;
        indicator.join(this.loop.background);
    }
    derivePitchingTrajectory(game) {
        this.setType(game.pitchInFlight.name, game.pitcher.throws === 'right' ? 1 : -1);
        var top = 200 - game.pitchTarget.y,
            left = game.pitchTarget.x,
            breakTop = 200 - game.pitchInFlight.y,
            breakLeft = game.pitchInFlight.x,
            flightTime = Mathinator.getFlightTime(game.pitchInFlight.velocity,
                helper.pitchDefinitions[game.pitchInFlight.name][2]);

        var scale = SCALE;
        var origin = {
            x: (game.pitcher.throws == 'left' ? 1.5 : -1.5),
            y: AbstractMesh.WORLD_BASE_Y + 6,
            z: -60.5 // mound distance
        };
        this.mesh.position.x = origin.x;
        this.mesh.position.y = origin.y;
        this.mesh.position.z = origin.z;

        var ARC_APPROXIMATION_Y_ADDITIVE = 38; // made up number
        var terminus = {
            x: (left - 100) * scale,
            y: (100 - top + 2 * ARC_APPROXIMATION_Y_ADDITIVE) * scale + Loop.VERTICAL_CORRECTION,
            z: INDICATOR_DEPTH
        };
        var breakingTerminus = {
            x: (breakLeft - 100) * scale,
            y: (100 - breakTop) * scale + Loop.VERTICAL_CORRECTION,
            z: INDICATOR_DEPTH
        };

        var lastPosition = {
            x: origin.x, y: origin.y, z: origin.z
        },
        lastBreakingPosition = {
            x: origin.x, y: origin.y, z: origin.z
        };

        var frames = [], breakingFrames = [],
            frameCount = flightTime * 60 | 0,
            counter = frameCount * 1.08 | 0,
            frame = 0;

        var xBreak = breakingTerminus.x - terminus.x,
            yBreak = breakingTerminus.y - terminus.y;
        var breakingDistance = Math.sqrt(Math.pow(xBreak, 2) + Math.pow(yBreak, 2));
        /**
         * @type {number} 1.0+, an expression of how late the pitch breaks
         */
        var breakingLateness = breakingDistance/(2 * ARC_APPROXIMATION_Y_ADDITIVE)/scale,
            breakingLatenessMomentumExponent = 0.2 + Math.pow(0.45, breakingLateness);

        while (counter--) {
            var progress = (++frame)/frameCount;

            // linear position
            var position = {
                x: origin.x + (terminus.x - origin.x) * progress,
                y: origin.y + (terminus.y - origin.y) * progress,
                z: origin.z + (terminus.z - origin.z) * progress
            };
            // linear breaking position
            var breakingInfluencePosition = {
                x: origin.x + (breakingTerminus.x - origin.x) * progress,
                y: origin.y + (breakingTerminus.y - origin.y) * progress,
                z: origin.z + (breakingTerminus.z - origin.z) * progress
            };
            if (progress > 1) {
                momentumScalar = 1 - Math.pow(progress, breakingLateness);
            } else {
                var momentumScalar = Math.pow(1 - progress, breakingLatenessMomentumExponent);
            }
            var breakingScalar = 1 - momentumScalar,
                scalarSum = momentumScalar + breakingScalar;
            // adjustment toward breaking ball position
            var breakingPosition = {
                x: (position.x * momentumScalar + breakingInfluencePosition.x * breakingScalar)/scalarSum,
                y: (position.y * momentumScalar + breakingInfluencePosition.y * breakingScalar)/scalarSum,
                z: (position.z * momentumScalar + breakingInfluencePosition.z * breakingScalar)/scalarSum
            };
            var increment = {
                x: position.x - lastPosition.x,
                y: position.y - lastPosition.y,
                z: position.z - lastPosition.z
            };
            var breakingIncrement = {
                x: breakingPosition.x - lastBreakingPosition.x,
                y: breakingPosition.y - lastBreakingPosition.y,
                z: breakingPosition.z - lastBreakingPosition.z
            };

            lastPosition = position;
            lastBreakingPosition = breakingPosition;

            breakingFrames.push(breakingIncrement);
            frames.push(increment);
        }

        var pause = 60;
        while (pause--) {
            breakingFrames.push({x:0, y:0, z:0});
            frames.push({x:0, y:0, z:0});
        }

        this.breakingTrajectory = breakingFrames;
        this.trajectory = frames;
        return frames;
    }
    deriveTrajectory(result, pitch) {
        var dragScalarApproximation = {
            distance: 1,
            apexHeight: 0.57,
            airTime: 0.96
        };

        var flyAngle = result.flyAngle,
            distance = Math.abs(result.travelDistance),
            scalar = result.travelDistance < 0 ? -1 : 1,
            flightScalar = flyAngle < 7 ? -1 : 1,
            splay = result.splay; // 0 is up the middle

        if (flightScalar < 0 && result.travelDistance > 0) {
            distance = Math.max(90, distance);
        }

        flyAngle = 1 + Math.abs(flyAngle); // todo why plus 1?
        if (flyAngle > 90) flyAngle = 180 - flyAngle;

        // velocity in m/s, I think
        var velocity = dragScalarApproximation.distance * Math.sqrt(9.81 * distance / Math.sin(2*Math.PI*flyAngle/180));
        var velocityVerticalComponent = Math.sin(Mathinator.RADIAN * flyAngle) * velocity;
        // in feet
        var apexHeight = velocityVerticalComponent*velocityVerticalComponent/(2*9.81) * dragScalarApproximation.apexHeight;
        // in seconds
        var airTime = 1.5 * Math.sqrt(2*apexHeight/9.81) * dragScalarApproximation.airTime; // 2x freefall equation

        this.airTime = airTime;

        var scale = SCALE;

        var origin = {
            x: pitch.x + result.x - 100,
            y: pitch.y + result.y - 100,
            z: 0
        };

        this.mesh.position.x = origin.x * scale;
        this.mesh.position.y = origin.y * scale;
        this.mesh.position.z = origin.z;

        var extrema = {
            x: Math.sin(splay / 180 * Math.PI) * distance,
            y: apexHeight,
            z: -Math.cos(splay / 180 * Math.PI) * distance
        };

        var frames = [],
            frameCount = airTime * 60 | 0,
            counter = frameCount,
            frame = 0;

        var lastHeight = 0;

        while (counter--) {
            var progress = (++frame)/frameCount,
                percent = progress * 100;

            // this equation is approximate
            if (flightScalar < 0) {
                var currentDistance = progress * distance;
                y = (origin.y * scale
                    + apexHeight*Math.abs(Math.sin(3 * Math.pow(currentDistance, 1.1) / distance * Math.PI/2)))
                    * ((100 - percent)/100)
                    + AbstractMesh.WORLD_BASE_Y * (progress);
            } else {
                var y = apexHeight - Math.pow(Math.abs(50 - percent)/50, 2) * apexHeight;
            }

            frames.push({
                x: extrema.x/frameCount,
                y: (y - lastHeight),
                z: extrema.z/frameCount
            });

            lastHeight = y;
        }
        this.trajectory = frames;
        return frames;
    }
}

Ball.prototype.DEFAULT_RPM = 1000;
Ball.prototype.RPM = 1000;
Ball.prototype.RPS = 1000 / 60;
Ball.prototype.RP60thOfASecond = 1000 / 60 / 60;
Ball.prototype.rotation = {
    x: Ball.prototype.RP60thOfASecond * 360 * Math.PI / 180, // in radians per 60th of a second
    y: Ball.prototype.RP60thOfASecond * 360 * Math.PI / 180
};

export { Ball }